import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_9282_TEAM_SETTINGS_CHAT_FLAG } from "@/lib/flags/definitions/htpr-9282-team-settings-chat";
import { AI_PROVIDERS, isAiProviderKey, isByokProviderKey, resolveTeamProviderEnabled } from "@/lib/aiProviders";
import type { SettingChange, SettingsScope } from "./catalog";

type TeamChange = Extract<SettingChange, { kind: "team-area" }>;
type Receipt = { id: string; userId: number; proposalId: string; action: string };
type Tx = Prisma.TransactionClient;
const denied = "Board not found or access denied.";
const ownerOnly = "Only the team owner can change this setting.";
const stale = "This setting changed since the preview. Ask for a fresh proposal.";
const unavailable = "These team settings are not available for your account.";
const listed = new Set(["board-general", "ai-models", "apiKeys", "skills", "webhooks", "management-keys"]);
async function allowed(userId: number) {
  if (!(await isFeatureEnabled(HTPR_9282_TEAM_SETTINGS_CHAT_FLAG, userId))) throw new Error(unavailable);
}
async function board(userId: number, projectId: number) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      status: { not: "Deleted" },
      OR: [{ ownerId: userId }, { members: { some: { userId, agentId: null, status: "Accepted" } } }],
    },
    select: { id: true, team: { select: { id: true, aiProviderSettings: true, googleAccount: { select: { userId: true } } } } },
  });
  if (!project?.team) throw new Error(denied);
  return project;
}
async function owned(userId: number, projectId: number) {
  const project = await board(userId, projectId);
  if (project.team.googleAccount.userId !== userId) throw new Error(ownerOnly);
  return project;
}
function numericId(target: string) {
  if (!/^[1-9]\d*$/.test(target)) throw new Error("Choose a listed item.");
  const id = Number(target);
  if (!Number.isSafeInteger(id)) throw new Error("Choose a listed item.");
  return id;
}
function providerSettings(settings: unknown, provider: string, enabled: boolean) {
  const current = settings && typeof settings === "object" && !Array.isArray(settings) ? { ...(settings as Record<string, unknown>) } : {};
  const bag = current.providers;
  if (bag && typeof bag === "object" && !Array.isArray(bag)) return { ...current, providers: { ...(bag as Record<string, unknown>), [provider]: enabled } };
  return { ...current, [provider]: enabled };
}
async function commit(write: (tx: Tx) => Promise<void>, operation?: Receipt) {
  await prisma.$transaction(async (tx) => {
    await write(tx);
    if (operation) await tx.aiSettingOperation.create({ data: operation });
  });
}

async function one(write: (tx: Tx) => Promise<{ count: number }>, operation?: Receipt) {
  await commit(async (tx) => { if ((await write(tx)).count !== 1) throw new Error(stale); }, operation);
}

export async function readTeamAreaPage(userId: number, scope: SettingsScope) {
  if (!listed.has(scope.section) || !(await isFeatureEnabled(HTPR_9282_TEAM_SETTINGS_CHAT_FLAG, userId)) || !scope.projectId) return null;
  if (scope.section === "skills") return { skills: await prisma.aI_Skill.findMany({ where: { userId, projectId: null }, select: { id: true, name: true, enabled: true }, orderBy: { id: "asc" } }) };
  const project = await board(userId, scope.projectId);
  if (scope.section === "board-general") {
    const columns = await prisma.section.findMany({ where: { projectId: project.id, deleted: false }, select: { id: true, section_title: true, visibility: true }, orderBy: { id: "asc" } });
    return { columns: columns.map((column) => ({ id: column.id, title: column.section_title, visible: column.visibility })) };
  }
  if (project.team.googleAccount.userId !== userId) return { ownerOnly: true };
  const teamId = project.team.id;
  if (scope.section === "ai-models") return { providers: AI_PROVIDERS.map((provider) => ({ key: provider.key, enabled: resolveTeamProviderEnabled(project.team.aiProviderSettings, provider.key) })) };
  if (scope.section === "apiKeys") return { keys: await prisma.teamByokApiKey.findMany({ where: { teamId }, select: { provider: true, enabled: true }, orderBy: { provider: "asc" } }) };
  if (scope.section === "webhooks") return { webhooks: await prisma.webhookSubscription.findMany({ where: { teamId }, select: { id: true, active: true }, orderBy: { id: "asc" } }) };
  return { keys: await prisma.betterAuthApiKey.findMany({ where: { teamId }, select: { id: true, name: true, enabled: true }, orderBy: { id: "asc" } }) };
}

export async function readTeamArea(userId: number, scope: SettingsScope, change: TeamChange) {
  await allowed(userId);
  if (change.area === "notification-default") {
    if (change.target !== "email") throw new Error("Choose the email notification switch.");
    const settings = await prisma.userSetting.findUnique({ where: { userId }, select: { notification: true } });
    if (!settings) throw new Error("User settings not found");
    return { label: "Email notifications", value: settings.notification };
  }
  if (!scope.projectId) throw new Error("Select a board first.");
  if (change.area === "column") {
    const column = await prisma.section.findFirst({ where: { id: numericId(change.target), projectId: (await board(userId, scope.projectId)).id, deleted: false }, select: { section_title: true, visibility: true } });
    if (!column) throw new Error("Column not found.");
    return { label: `${column.section_title} column visible`, value: column.visibility };
  }
  if (change.area === "skill") {
    const skill = await prisma.aI_Skill.findFirst({ where: { id: numericId(change.target), userId, projectId: null }, select: { name: true, enabled: true } });
    if (!skill) throw new Error("Skill not found or access denied.");
    return { label: `${skill.name} skill`, value: skill.enabled };
  }
  const project = await owned(userId, scope.projectId);
  const teamId = project.team.id;
  if (change.area === "ai-model") {
    if (!isAiProviderKey(change.target)) throw new Error("Unknown AI provider.");
    return { label: `${AI_PROVIDERS.find((provider) => provider.key === change.target)?.label ?? change.target} models`, value: resolveTeamProviderEnabled(project.team.aiProviderSettings, change.target) };
  }
  if (change.area === "ai-key") {
    if (!isByokProviderKey(change.target)) throw new Error("Unknown AI key.");
    const key = await prisma.teamByokApiKey.findFirst({ where: { teamId, provider: change.target }, select: { enabled: true, provider: true } });
    if (!key) throw new Error("Add the key on the Bring your own key page first.");
    return { label: `${key.provider} key enabled`, value: key.enabled };
  }
  if (change.area === "integration") {
    const hook = await prisma.webhookSubscription.findFirst({ where: { id: change.target, teamId }, select: { active: true } });
    if (!hook) throw new Error("Webhook not found.");
    return { label: "Webhook active", value: hook.active };
  }
  const token = await prisma.betterAuthApiKey.findFirst({ where: { id: numericId(change.target), teamId }, select: { name: true, enabled: true } });
  if (!token) throw new Error("Management key not found.");
  return { label: `${token.name || "Management key"} enabled`, value: token.enabled };
}

export async function applyTeamArea(userId: number, scope: SettingsScope, change: TeamChange, expected: boolean, next: boolean, operation?: Receipt) {
  if ((await readTeamArea(userId, scope, change)).value !== expected) throw new Error(stale);
  if (change.area === "notification-default") {
    await one((tx) => tx.userSetting.updateMany({ where: { userId, notification: expected }, data: { notification: next } }), operation);
    return;
  }
  const projectId = scope.projectId;
  if (!projectId) throw new Error("Select a board first.");
  if (change.area === "column") {
    await one((tx) => tx.section.updateMany({ where: { id: numericId(change.target), projectId, deleted: false, visibility: expected }, data: { visibility: next } }), operation);
    return;
  }
  if (change.area === "skill") {
    await one((tx) => tx.aI_Skill.updateMany({ where: { id: numericId(change.target), userId, projectId: null, enabled: expected }, data: { enabled: next } }), operation);
    return;
  }
  const teamId = (await owned(userId, projectId)).team.id;
  if (change.area === "ai-model") {
    if (!isAiProviderKey(change.target)) throw new Error("Unknown AI provider.");
    const provider = change.target;
    await commit(async (tx) => {
      const team = await tx.team.findUnique({ where: { id: teamId }, select: { aiProviderSettings: true } });
      if (resolveTeamProviderEnabled(team?.aiProviderSettings, provider) !== expected) throw new Error(stale);
      const stored = providerSettings(team?.aiProviderSettings, provider, next);
      if (resolveTeamProviderEnabled(stored, provider) !== next) throw new Error("Turn off GDPR safe mode before enabling this provider.");
      await tx.team.update({ where: { id: teamId }, data: { aiProviderSettings: stored } });
    }, operation);
    return;
  }
  if (change.area === "ai-key") {
    await one((tx) => tx.teamByokApiKey.updateMany({ where: { teamId, provider: change.target, enabled: expected }, data: { enabled: next } }), operation);
    return;
  }
  if (change.area === "integration") {
    await one((tx) => tx.webhookSubscription.updateMany({ where: { id: change.target, teamId, active: expected }, data: { active: next } }), operation);
    return;
  }
  await one((tx) => tx.betterAuthApiKey.updateMany({ where: { id: numericId(change.target), teamId, enabled: expected }, data: { enabled: next } }), operation);
}
