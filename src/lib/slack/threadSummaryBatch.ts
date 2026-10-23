import { gatewayFundingSourceForApiKey } from "@/app/api/ai/_lib/modelProvider";
import { gatewayCatalogModelSlug } from "@/app/api/ai/_lib/sharedAllowance";
import {
  batchEligibleFunding,
  batchEligibleModel,
  buildSlackSummaryBatchRequest,
  chunkForBatch,
  groupByKey,
  type SlackSummaryBatchItem,
} from "@/lib/ai/batch/batchJobs";
import { submitBatch } from "@/lib/ai/batch/submitBatch";
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
  | { type: "empty" }
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
  const model = gatewayCatalogModelSlug(systemModel.model);
  if (haikuByok || !gatewayApiKey || !batchEligibleModel(model) || !batchEligibleFunding(gatewayFundingSourceForApiKey(gatewayApiKey))) {
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
      model,
      gatewayKey: gatewayApiKey,
      teamId: context.teamId,
      userId: context.installedByUserId,
    },
  };
}

export async function submitSlackSummaryBatches(entries: SlackBatchEntry[]) {
  const queued: string[] = [];
  const failed: string[] = [];
  const groups = groupByKey(entries, (entry) => `${entry.teamId}|${entry.model}`);
  for (const group of groups.values()) {
    for (const chunk of chunkForBatch(group)) {
      const first = chunk[0];
      let claimedIds: string[] = [];
      try {
        await submitBatch({
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
            }),
          ),
          items: Object.fromEntries(chunk.map((entry) => [entry.threadId, entry.item])),
          claim: async (tx, batchId) => {
            await tx.slackWatchedThread.updateMany({
              where: { id: { in: chunk.map((entry) => entry.threadId) }, summaryBatchId: null },
              data: { summaryBatchId: batchId },
            });
            const held = await tx.slackWatchedThread.findMany({
              where: { summaryBatchId: batchId },
              select: { id: true },
            });
            claimedIds = held.map(({ id }) => id);
            return claimedIds;
          },
        });
        queued.push(...claimedIds);
      } catch (error) {
        failed.push(...chunk.map((entry) => entry.threadId));
        console.error("Slack summary batch submit failed", error);
      }
    }
  }
  return { queued, failed };
}
