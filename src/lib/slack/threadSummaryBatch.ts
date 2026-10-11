/**
 * HTPR-7098: Slack thread summaries that wait in a half-price gateway batch instead of running
 * inline. The cron prepares one entry per thread here; the collector applies the result later.
 */
import { gatewayFundingSourceForApiKey } from "@/app/api/ai/_lib/modelProvider";
import { gatewayCatalogModelSlug } from "@/app/api/ai/_lib/sharedAllowance";
import {
  batchEligibleFunding,
  batchProviderOptions,
  buildSlackSummaryBatchRequest,
  chunkForBatch,
  groupByKey,
  type SlackSummaryBatchItem,
} from "@/lib/ai/batch/batchJobs";
import { submitBatch } from "@/lib/ai/batch/submitBatch";
import prisma from "@/lib/prisma";
import {
  loadSlackThreadSource,
  resolveSlackSummaryModelInputs,
  type SlackThreadSource,
  type SlackThreadSummaryContext,
} from "@/lib/slack/threadSummary";

export type SlackBatchEntry = {
  threadId: string;
  item: SlackSummaryBatchItem;
  transcript: string;
  model: string;
  gatewayKey: string;
  teamId: string;
  userId: number;
};

export type PreparedSlackSummary =
  /** Nothing to summarize (no text, or summaries are off for the team): mark the thread done. */
  | { type: "empty" }
  /** Team's own key or no usable gateway key: run the instant path with the source already loaded. */
  | { type: "instant"; source: SlackThreadSource }
  | { type: "batch"; entry: SlackBatchEntry };

export async function prepareSlackSummaryForBatch(
  context: SlackThreadSummaryContext,
  thread: { id: string; lastMessageTs: string },
  taskIds: number[],
): Promise<PreparedSlackSummary> {
  const source = await loadSlackThreadSource(context);
  if (!source.transcript) return { type: "empty" };

  const inputs = await resolveSlackSummaryModelInputs(context);
  if (!inputs) return { type: "empty" };
  const { systemModel, gatewayApiKey, haikuByok } = inputs;
  if (haikuByok || !gatewayApiKey || !batchEligibleFunding(gatewayFundingSourceForApiKey(gatewayApiKey))) {
    return { type: "instant", source };
  }

  return {
    type: "batch",
    entry: {
      threadId: thread.id,
      item: {
        threadId: thread.id,
        taskIds,
        projectId: context.projectId,
        lastMessageTsAtSubmit: thread.lastMessageTs,
        participants: source.participants,
        permalink: source.permalink,
      },
      transcript: source.transcript,
      model: gatewayCatalogModelSlug(systemModel.model),
      gatewayKey: gatewayApiKey,
      teamId: context.teamId,
      userId: context.installedByUserId,
    },
  };
}

/** One batch per team and model. Returns the ids of threads that were queued, and those that failed to queue. */
export async function submitSlackSummaryBatches(entries: SlackBatchEntry[]) {
  const queued: string[] = [];
  const failed: string[] = [];
  const groups = groupByKey(entries, (entry) => `${entry.teamId}|${entry.model}`);
  for (const group of groups.values()) {
    for (const chunk of chunkForBatch(group)) {
      const first = chunk[0];
      try {
        const batchId = await submitBatch({
          kind: "slack-summary",
          teamId: first.teamId,
          userId: first.userId,
          model: first.model,
          gatewayKey: first.gatewayKey,
          requests: chunk.map((entry) =>
            buildSlackSummaryBatchRequest({
              id: entry.threadId,
              model: entry.model,
              transcript: entry.transcript,
              providerOptions: batchProviderOptions("summary", {
                teamId: entry.teamId,
                projectId: entry.item.projectId,
                userId: entry.userId,
              }),
            }),
          ),
          items: Object.fromEntries(chunk.map((entry) => [entry.threadId, entry.item])),
        });
        await prisma.slackWatchedThread.updateMany({
          where: { id: { in: chunk.map((entry) => entry.threadId) } },
          data: { summaryBatchId: batchId },
        });
        queued.push(...chunk.map((entry) => entry.threadId));
      } catch (error) {
        failed.push(...chunk.map((entry) => entry.threadId));
        console.error("Slack summary batch submit failed", error);
      }
    }
  }
  return { queued, failed };
}
