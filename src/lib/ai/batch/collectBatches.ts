import { logAiUsage } from "@/app/api/ai/_lib/aiUsage";
import { getTeamGatewayApiKey } from "@/app/api/ai/_lib/byokKeys";
import { TeamKeyOnlyRefusal } from "@/lib/ai/teamAiFunding";
import { modelCostUsd, modelPricing } from "@/app/api/ai/_lib/sharedAllowance";
import {
  buildBatchUsageRow,
  isBatchStale,
  labelActionForOutcome,
  nextSummarizedTs,
  outcomesForItems,
  slackHtmlWithInstantFallback,
  type BatchItemOutcome,
  type SlackSummaryBatchItem,
  type SmartLabelBatchItem,
} from "@/lib/ai/batch/batchJobs";
import { cancelGatewayBatch, gatewayBatchOutcomes, gatewayBatchState } from "@/lib/ai/batch/gatewayBatch";
import { applyAiLabelVerdict, classifyLabelItemInstantly, getAiActor } from "@/lib/ai/labelClassifier";
import { generalConfig } from "@/lib/configs/general.config";
import { decryptSecret } from "@/lib/crypto/byokCipher";
import { buildSlackThreadSummaryComment } from "@/lib/slack/threadSummary";
import prisma from "@/lib/prisma";
import { createCommentService } from "@/utils/controllers/comments/createCommentService";

const MAX_BATCHES_PER_RUN = 20;
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
const APPLY_RECLAIM_MS = 15 * 60 * 1000;
const MAX_RUN_MS = 240 * 1000;

type BatchRow = {
  id: string;
  gatewayBatchId: string;
  kind: string;
  teamId: string;
  userId: number;
  model: string;
  items: unknown;
  createdAt: Date;
};

export async function collectBatches(nowMs = Date.now()) {
  const pending = await prisma.aiBatch.findMany({
    where: {
      OR: [
        { status: "pending" },
        { status: "applying", claimedAt: { lt: new Date(nowMs - APPLY_RECLAIM_MS) } },
      ],
    },
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
    take: MAX_BATCHES_PER_RUN,
  });
  let completed = 0;
  let cancelled = 0;
  for (const batch of pending) {
    if (Date.now() - nowMs > MAX_RUN_MS) break;
    try {
      const result = await collectOne(batch, nowMs);
      if (result === "completed") completed += 1;
      if (result === "cancelled") cancelled += 1;
    } catch (error) {
      console.error(`AI batch ${batch.id} collection failed`, error);
    }
  }
  const released = await releaseOrphanedSlackThreads(nowMs);
  return { pending: pending.length, completed, cancelled, releasedThreads: released };
}

type Plan = { outcomes: BatchItemOutcome[]; finalStatus: "completed" | "cancelled" } | "waiting";

async function planBatch(batch: BatchRow, itemIds: string[], stale: boolean): Promise<Plan> {
  const allFailed = outcomesForItems(itemIds, []);
  let gatewayKey: string | undefined;
  try {
    gatewayKey = await getTeamGatewayApiKey({ trustedTeamId: batch.teamId });
  } catch (error) {
    if (!(typeof TeamKeyOnlyRefusal === "function" && error instanceof TeamKeyOnlyRefusal)) throw error;
    console.error(`[ai-batch] ${error.message}`);
    return { outcomes: allFailed, finalStatus: "cancelled" };
  }
  if (!gatewayKey) {
    return stale ? { outcomes: allFailed, finalStatus: "cancelled" } : "waiting";
  }
  const state = await gatewayBatchState(gatewayKey, batch.gatewayBatchId);
  if (state === "pending") {
    if (!stale) return "waiting";
    await cancelGatewayBatch(gatewayKey, batch.gatewayBatchId).catch((error) =>
      console.error(`AI batch ${batch.id} cancel failed`, error),
    );
    return { outcomes: allFailed, finalStatus: "cancelled" };
  }
  if (state === "failed") {
    const outcomes = await gatewayBatchOutcomes(gatewayKey, batch.gatewayBatchId, itemIds).catch(() => allFailed);
    return { outcomes, finalStatus: "completed" };
  }
  return { outcomes: await gatewayBatchOutcomes(gatewayKey, batch.gatewayBatchId, itemIds), finalStatus: "completed" };
}

async function collectOne(batch: BatchRow, nowMs: number): Promise<"waiting" | "completed" | "cancelled"> {
  await prisma.aiBatch.update({ where: { id: batch.id }, data: { lastCheckedAt: new Date() } });
  const items = (batch.items ?? {}) as Record<string, unknown>;
  const itemIds = Object.keys(items);
  const stale = isBatchStale(batch.createdAt, nowMs);

  let plan: Plan;
  try {
    plan = await planBatch(batch, itemIds, stale);
  } catch (error) {
    if (!stale) throw error;
    console.error(`AI batch ${batch.id} is stale and errored; cancelling`, error);
    plan = { outcomes: outcomesForItems(itemIds, []), finalStatus: "cancelled" };
  }
  if (plan === "waiting") return "waiting";

  const claimed = await prisma.aiBatch.updateMany({
    where: {
      id: batch.id,
      OR: [
        { status: "pending" },
        { status: "applying", claimedAt: { lt: new Date(nowMs - APPLY_RECLAIM_MS) } },
      ],
    },
    data: { status: "applying", claimedAt: new Date() },
  });
  if (claimed.count === 0) return "waiting";

  if (batch.kind === "slack-summary") await applySlackBatch(batch, items, plan.outcomes);
  else if (batch.kind === "smart-label") await applyLabelBatch(batch, items, plan.outcomes);
  await prisma.aiBatch.update({ where: { id: batch.id }, data: { status: plan.finalStatus, completedAt: new Date() } });
  return plan.finalStatus;
}

async function logUsage(
  batch: BatchRow,
  outcome: BatchItemOutcome,
  ids: { projectId: number | null; taskId: number | null },
) {
  if (outcome.status !== "succeeded") {
    await logAiUsage({
      ...ids, userId: batch.userId, teamId: batch.teamId,
      provider: "gateway-batch", model: batch.model,
      feature: batch.kind === "slack-summary" ? "summary" : "smart-label",
      outcome: outcome.status, costUsd: null,
    });
    return;
  }
  let normalCostUsd: number | null = null;
  try {
    const pricing = await modelPricing(batch.model);
    normalCostUsd = pricing
      ? modelCostUsd(
          pricing,
          outcome.usage.inputTokens,
          outcome.usage.outputTokens,
          outcome.usage.cachedInputTokens ?? 0,
          outcome.usage.cacheWriteInputTokens ?? 0,
        )
      : null;
  } catch {
    normalCostUsd = null;
  }
  await logAiUsage(
    buildBatchUsageRow({
      kind: batch.kind as "slack-summary" | "smart-label",
      userId: batch.userId,
      teamId: batch.teamId,
      projectId: ids.projectId,
      taskId: ids.taskId,
      model: batch.model,
      usage: outcome.usage,
      normalCostUsd,
    }),
  );
}

async function applySlackBatch(batch: BatchRow, items: Record<string, unknown>, outcomes: BatchItemOutcome[]) {
  const botUser = await prisma.user.findUnique({
    where: { id: generalConfig.hyperAiId },
    select: { id: true, email: true, displayName: true, photoURL: true },
  });
  const userNameCache = new Map<string, Promise<string>>();
  for (const outcome of outcomes) {
    const item = items[outcome.id] as SlackSummaryBatchItem;
    const release = { id: item.threadId, summaryBatchId: batch.id };
    try {
      const marked = await prisma.slackWatchedThread.findUnique({
        where: { id: item.threadId },
        select: { lastSummarizedTs: true, summaryBatchId: true },
      });
      if (marked?.summaryBatchId !== batch.id) continue;
      await logUsage(batch, outcome, {
        projectId: item.projectId,
        taskId: item.taskIds.length === 1 ? item.taskIds[0] : null,
      });
      if (!botUser) {
        await prisma.slackWatchedThread.updateMany({ where: release, data: { summaryBatchId: null } });
        continue;
      }
      const tasks = await prisma.task.findMany({
        where: { id: { in: item.taskIds }, status: { not: "Deleted" }, project: { teamId: batch.teamId } },
        select: { id: true, projectId: true, userId: true },
      });
      const result = await slackHtmlWithInstantFallback(outcome, item, async () => {
        const watched = await prisma.slackWatchedThread.findUnique({
          where: { id: item.threadId },
          include: { install: { include: { team: { select: { aiProviderSettings: true } } } } },
        });
        if (!watched || tasks.length === 0) return null;
        const projectIds = [...new Set(tasks.map((task) => task.projectId))];
        return buildSlackThreadSummaryComment({
          aiProviderSettings: watched.install.team.aiProviderSettings,
          botToken: decryptSecret(watched.install.encryptedBotToken),
          channelId: watched.channelId,
          installedByUserId: watched.install.installedByUserId,
          projectId: projectIds.length === 1 ? projectIds[0] : null,
          taskId: tasks.length === 1 ? tasks[0].id : null,
          teamId: watched.install.teamId,
          threadTs: watched.threadTs,
          userNameCache,
        });
      });
      if (result.type === "failed") {
        console.error(`Slack batch item and instant fallback failed for thread ${item.threadId}`);
        await prisma.slackWatchedThread.updateMany({ where: release, data: { summaryBatchId: null } });
        continue;
      }
      if (result.type === "comment") {
        const delivered = new Set(item.deliveredTaskIds ?? []);
        for (const task of tasks) {
          if (delivered.has(task.id)) continue;
          await createCommentService({
            text: result.html,
            creatorId: botUser.id,
            taskId: task.id,
            ownerId: task.userId,
            currentUser: botUser,
            agentId: null,
            processTaskReferences: false,
            trustedCaller: true,
          });
          delivered.add(task.id);
          item.deliveredTaskIds = [...delivered];
          await prisma.aiBatch.update({ where: { id: batch.id }, data: { items: items as object } });
        }
      }
      await prisma.slackWatchedThread.update({
        where: { id: item.threadId },
        data: {
          lastSummarizedTs: nextSummarizedTs(marked.lastSummarizedTs, item.lastMessageTsAtSubmit),
          summaryBatchId: null,
        },
      });
    } catch (error) {
      console.error(`Slack batch result failed for thread ${item.threadId}`, error);
      await prisma.slackWatchedThread
        .updateMany({ where: release, data: { summaryBatchId: null } })
        .catch(() => undefined);
    }
  }
}

async function applyLabelBatch(batch: BatchRow, items: Record<string, unknown>, outcomes: BatchItemOutcome[]) {
  const actor = await getAiActor();
  for (const outcome of outcomes) {
    const item = items[outcome.id] as SmartLabelBatchItem;
    try {
      await logUsage(batch, outcome, { projectId: item.projectId, taskId: item.taskId });
      const action = labelActionForOutcome(outcome, item);
      if (action.type === "instant") {
        await classifyLabelItemInstantly(item.taskId, item.projectId, action.definitions);
        continue;
      }
      const result = await applyAiLabelVerdict({
        taskId: item.taskId,
        projectId: item.projectId,
        definitions: action.definitions,
        matchingLabelIds: action.matchingLabelIds,
        actor,
        snapshotAt: new Date(item.snapshotAt),
        contentHash: item.contentHash,
      });
      if (result === "stale") {
        await classifyLabelItemInstantly(item.taskId, item.projectId, action.definitions);
      }
    } catch (error) {
      console.error(`Smart label batch result failed for task ${item.taskId}`, error);
    }
  }
}

async function releaseOrphanedSlackThreads(nowMs: number): Promise<number> {
  const marked = await prisma.slackWatchedThread.findMany({
    where: { summaryBatchId: { not: null } },
    select: { summaryBatchId: true },
    distinct: ["summaryBatchId"],
  });
  const ids = marked.flatMap(({ summaryBatchId }) => (summaryBatchId ? [summaryBatchId] : []));
  if (ids.length === 0) return 0;
  const batches = await prisma.aiBatch.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, completedAt: true },
  });
  const keep = new Set(
    batches
      .filter(
        ({ status, completedAt }) =>
          status === "pending" || status === "applying" || (completedAt && nowMs - completedAt.getTime() < ORPHAN_GRACE_MS),
      )
      .map(({ id }) => id),
  );
  const orphaned = ids.filter((id) => !keep.has(id));
  if (orphaned.length === 0) return 0;
  const released = await prisma.slackWatchedThread.updateMany({
    where: { summaryBatchId: { in: orphaned } },
    data: { summaryBatchId: null },
  });
  return released.count;
}
