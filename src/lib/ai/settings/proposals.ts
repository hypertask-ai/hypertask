import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7622_AI_SETTINGS_FLAG } from "@/lib/flags/definitions/htpr-7622-ai-settings";
import { applySettingChange, readSettingChange } from "./actions";
import { settingProposalCard, type SettingChange, type SettingProposal, type SettingsScope } from "./catalog";

const TTL_SECONDS = 900;
const proposalKey = (userId: number, id: string) => `ai-setting:${userId}:${id}`;

export async function assertSettingsEnabled(userId: number, agentId?: string | null) {
  if (agentId || !(await isFeatureEnabled(HTPR_7622_AI_SETTINGS_FLAG, userId))) throw new Error("AI settings changes are not available for this account.");
}

export async function createSettingProposal(userId: number, sessionId: string, scope: SettingsScope, change: SettingChange) {
  await assertSettingsEnabled(userId);
  const session = await prisma.chatSession.findFirst({ where: { id: sessionId, userId, agentId: null }, select: { id: true } });
  if (!session) throw new Error("Open a personal AI chat first.");
  const current = await readSettingChange(userId, scope, change);
  if (current.value === change.value) throw new Error("That setting already has the requested value.");
  const proposal: SettingProposal = {
    id: randomUUID(), userId, sessionId, scope, change, label: current.label,
    before: current.value, after: change.value, status: "pending",
  };
  const redis = await getRedis();
  await redis.set(proposalKey(userId, proposal.id), JSON.stringify(proposal), "EX", TTL_SECONDS);
  return settingProposalCard(proposal);
}

export async function loadSettingProposal(userId: number, id: string) {
  await assertSettingsEnabled(userId);
  const redis = await getRedis();
  const raw = await redis.get(proposalKey(userId, id));
  if (!raw) throw new Error("This change expired or is not yours. Ask for a fresh proposal.");
  const proposal = JSON.parse(raw) as SettingProposal & { applying?: boolean };
  if (proposal.userId !== userId || proposal.id !== id) throw new Error("Setting change not found.");
  const session = await prisma.chatSession.findFirst({ where: { id: proposal.sessionId, userId, agentId: null }, select: { id: true } });
  if (!session) throw new Error("Chat no longer available.");
  return proposal;
}

export async function actOnSettingProposal(userId: number, id: string, action: "apply" | "cancel" | "undo", scope?: SettingsScope) {
  const redis = await getRedis();
  const key = proposalKey(userId, id);
  const lockKey = `${key}:lock`;
  const lock = randomUUID();
  if (!(await redis.set(lockKey, lock, "EX", 120, "NX"))) throw new Error("This change is already being processed.");
  try {
    const proposal = await loadSettingProposal(userId, id);
    if (action === "cancel") {
      if (proposal.status !== "pending" || proposal.applying) throw new Error("This change is no longer pending.");
      proposal.status = "cancelled";
    } else {
      if (!scope || scope.section !== proposal.scope.section || scope.projectId !== proposal.scope.projectId) {
        throw new Error("Return to the original settings page and board before applying or undoing this change.");
      }
      const undo = action === "undo";
      const currentScope = { ...proposal.scope, ...(scope.theme ? { theme: scope.theme } : {}) };
      let recovered = false;
      if (proposal.applying) {
        const current = await readSettingChange(userId, currentScope, proposal.change);
        if (current.value === proposal.after) {
          proposal.status = "applied";
          recovered = !undo;
        }
      }
      if (!recovered && proposal.status !== (undo ? "applied" : "pending")) throw new Error("This action has already been handled.");
      if (!undo && !recovered) {
        const current = await readSettingChange(userId, currentScope, proposal.change);
        if (current.value !== proposal.before) throw new Error("This setting changed since the preview. Ask for a fresh proposal.");
        proposal.applying = true;
        await redis.set(key, JSON.stringify(proposal), "EX", TTL_SECONDS);
      }
      const result: { theme?: SettingsScope["theme"] } = recovered ? {} : await applySettingChange(proposal, undo, scope.theme);
      proposal.status = undo ? "undone" : "applied";
      delete proposal.applying;
      await redis.set(key, JSON.stringify(proposal), "EX", TTL_SECONDS);
      return { proposal: settingProposalCard(proposal), ...result };
    }
    await redis.set(key, JSON.stringify(proposal), "EX", TTL_SECONDS);
    return { proposal: settingProposalCard(proposal) };
  } finally {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, lock).catch((error) => console.error("[AI settings] proposal lock release failed", error));
  }
}
