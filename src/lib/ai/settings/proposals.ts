import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7622_AI_SETTINGS_FLAG } from "@/lib/flags/definitions/htpr-7622-ai-settings";
import { applySettingChange, readSettingChange } from "./actions";
import { settingProposalCard, type SettingChange, type SettingProposal, type SettingsScope } from "./catalog";

const TTL_SECONDS = 900;
const proposalKey = (userId: number, id: string) => `ai-setting:${userId}:${id}`;

type SettingProposalOperation = { action: "apply" | "undo"; id: string; committed?: boolean };
type StoredProposal = SettingProposal & { operation?: SettingProposalOperation };

// The database receipt is written inside the same transaction as the change, so it proves the
// write happened even when the Redis proposal record could not record it.
async function operationReachedDatabase(userId: number, proposalId: string, operationId: string) {
  const row = await prisma.aiSettingOperation.findFirst({ where: { id: operationId, userId, proposalId }, select: { id: true } });
  return Boolean(row);
}

async function forgetOperation(operationId: string) {
  await prisma.aiSettingOperation.deleteMany({ where: { id: operationId } })
    .catch((error) => console.error("[AI settings] operation receipt cleanup failed", error));
}

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
  const proposal = JSON.parse(raw) as StoredProposal;
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
      if (proposal.status !== "pending" || proposal.operation) throw new Error("This change is no longer pending.");
      proposal.status = "cancelled";
    } else {
      if (!scope || scope.section !== proposal.scope.section || scope.projectId !== proposal.scope.projectId) {
        throw new Error("Return to the original settings page and board before applying or undoing this change.");
      }
      const undo = action === "undo";
      const currentScope = { ...proposal.scope, ...(scope.theme ? { theme: scope.theme } : {}) };
      const operation = proposal.operation;
      if (operation) {
        const reached = operation.committed ?? await operationReachedDatabase(userId, proposal.id, operation.id);
        if (reached) {
          const operationUndo = operation.action === "undo";
          const destination = operationUndo ? proposal.before : proposal.after;
          const current = await readSettingChange(userId, currentScope, proposal.change, undo ? proposal.before : proposal.after);
          if (current.value !== destination && !(proposal.change.kind === "theme" && current.value === (operationUndo ? proposal.after : proposal.before))) {
            throw new Error("This setting changed since the preview. Ask for a fresh proposal.");
          }
          const recoveredAction = operation.action;
          proposal.status = operationUndo ? "undone" : "applied";
          delete proposal.operation;
          await redis.set(key, JSON.stringify(proposal), "EX", TTL_SECONDS);
          void forgetOperation(operation.id);
          if (action === recoveredAction) {
            return { proposal: settingProposalCard(proposal), ...(proposal.change.kind === "theme" ? { theme: destination as SettingsScope["theme"] } : {}) };
          }
        } else {
          // The change never reached the database, so the stored intent is stale: retry from a clean state.
          delete proposal.operation;
          await redis.set(key, JSON.stringify(proposal), "EX", TTL_SECONDS);
        }
      }
      if (proposal.status !== (undo ? "applied" : "pending")) {
        // A theme action only delivers a cookie: repeating the same action re-sends it.
        if (proposal.change.kind === "theme" && proposal.status === (undo ? "undone" : "applied")) {
          return { proposal: settingProposalCard(proposal), theme: (undo ? proposal.before : proposal.after) as SettingsScope["theme"] };
        }
        throw new Error("This action has already been handled.");
      }
      const current = await readSettingChange(userId, currentScope, proposal.change, undo ? proposal.before : proposal.after);
      if (current.value !== (undo ? proposal.after : proposal.before)) throw new Error("This setting changed since the preview. Ask for a fresh proposal.");
      const operationId = randomUUID();
      proposal.operation = { action, id: operationId };
      await redis.set(key, JSON.stringify(proposal), "EX", TTL_SECONDS);
      let result: { theme?: SettingsScope["theme"] };
      try {
        result = await applySettingChange(proposal, undo, scope.theme, { id: operationId, action });
      } catch (error) {
        delete proposal.operation;
        await redis.set(key, JSON.stringify(proposal), "EX", TTL_SECONDS)
          .catch((saveError) => console.error("[AI settings] proposal cleanup save failed", saveError));
        throw error;
      }
      proposal.operation.committed = true;
      await redis.set(key, JSON.stringify(proposal), "EX", TTL_SECONDS);
      proposal.status = undo ? "undone" : "applied";
      delete proposal.operation;
      await redis.set(key, JSON.stringify(proposal), "EX", TTL_SECONDS);
      void forgetOperation(operationId);
      return { proposal: settingProposalCard(proposal), ...result };
    }
    await redis.set(key, JSON.stringify(proposal), "EX", TTL_SECONDS);
    return { proposal: settingProposalCard(proposal) };
  } finally {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, lock).catch((error) => console.error("[AI settings] proposal lock release failed", error));
  }
}
