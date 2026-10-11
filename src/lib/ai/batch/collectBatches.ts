/**
 * HTPR-7098: collects finished gateway batches and applies each result exactly as the instant
 * path would have (Slack comment, smart label verdict), then logs half-price usage.
 */
import { logAiUsage } from "@/app/api/ai/_lib/aiUsage";
import { getTeamGatewayApiKey } from "@/app/api/ai/_lib/byokKeys";
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
import { applyAiLabelVerdict, getAiActor } from "@/lib/ai/labelClassifier";
import { generalConfig } from "@/lib/configs/general.config";
import { decryptSecret } from "@/lib/crypto/byokCipher";
import { buildSlackThreadSummaryComment } from "@/lib/slack/threadSummary";
import prisma from "@/lib/prisma";
import { createCommentService } from "@/utils/controllers/comments/createCommentService";

const MAX_BATCHES_PER_RUN = 20;
const ORPHAN_GRACE_MS = 60 * 60 * 1000;

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
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: MAX_BATCHES_PER_RUN,
  });
  let completed = 0;
  let cancelled = 0;
  for (const batch of pending) {
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

async function collectOne(batch: BatchRow, nowMs: number): Promise<"waiting" | "completed" | "cancelled"> {
  const items = (batch.items ?? {}) as Record<string, unknown>;
  const itemIds = Object.keys(items);
  const gatewayKey = await getTeamGatewayApiKey({ trustedTeamId: batch.teamId });
  const stale = isBatchStale(batch.createdAt, nowMs);

  let outcomes: BatchItemOutcome[];
  let finalStatus: "completed" | "cancelled" = "completed";
  if (!gatewayKey) {
    if (!stale) return "waiting";
    outcomes = outcomesForItems(itemIds, []);
    finalStatus = "cancelled";
  } else {
    const state = await gatewayBatchState(gatewayKey, batch.gatewayBatchId);
    if (state === "pending") {
      if (!stale) return "waiting";
      // Gateway batches end within 24h. Past 25h, stop waiting and let the work retry.
      await cancelGatewayBatch(gatewayKey, batch.gatewayBatchId).catch((error) =>
        console.error(`AI batch ${batch.id} cancel failed`, error),
      );
      outcomes = outcomesForItems(itemIds, []);
      finalStatus = "cancelled";
    } else if (state === "failed") {
      outcomes = outcomesForItems(itemIds, []);
    } else {
      outcomes = await gatewayBatchOutcomes(gatewayKey, batch.gatewayBatchId, itemIds);
    }
  }

  // Claim before applying so an overlapping cron run cannot post the same results twice.
  const claimed = await prisma.aiBatch.updateMany({
    where: { id: batch.id, status: "pending" },
    data: { status: finalStatus, completedAt: new Date() },
  });
  if (claimed.count === 0) return "waiting";

  if (batch.kind === "slack-summary") await applySlackBatch(batch, items, outcomes);
  else if (batch.kind === "smart-label") await applyLabelBatch(batch, items, outcomes);
  return finalStatus;
}

async function logUsage(
  batch: BatchRow,
  outcome: BatchItemOutcome,
  ids: { projectId: number | null; taskId: number | null },
) {
  if (outcome.status !== "succeeded") return;
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
      // A bad item is summarized once through the instant path (never batched again).
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
        // Same as the cron on a failure: leave the summarized mark alone and report it.
        console.error(`Slack batch item and instant fallback failed for thread ${item.threadId}`);
        await prisma.slackWatchedThread.updateMany({ where: release, data: { summaryBatchId: null } });
        continue;
      }
      if (result.type === "comment") {
        for (const task of tasks) {
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
        }
      }
      const thread = await prisma.slackWatchedThread.findUnique({
        where: { id: item.threadId },
        select: { lastSummarizedTs: true, summaryBatchId: true },
      });
      if (thread?.summaryBatchId !== batch.id) continue;
      await prisma.slackWatchedThread.update({
        where: { id: item.threadId },
        data: {
          lastSummarizedTs: nextSummarizedTs(thread.lastSummarizedTs, item.lastMessageTsAtSubmit),
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
      if (action.type === "skip") continue;
      await applyAiLabelVerdict({
        taskId: item.taskId,
        projectId: item.projectId,
        definitions: action.definitions,
        matchingLabelIds: action.matchingLabelIds,
        actor,
        snapshotAt: new Date(item.snapshotAt),
      });
    } catch (error) {
      console.error(`Smart label batch result failed for task ${item.taskId}`, error);
    }
  }
}

/**
 * A run that died after claiming a batch would leave its threads marked pending forever.
 * Release marks whose batch is gone, or was finished more than an hour ago.
 */
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
          status === "pending" || (completedAt && nowMs - completedAt.getTime() < ORPHAN_GRACE_MS),
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
