/**
 * HTPR-7098: pure helpers for background AI jobs that wait in a gateway batch (half price).
 * No database, network or SDK calls here, so every rule can be tested on its own.
 */
import {
  labelClassifierPrompt,
  LABEL_CLASSIFIER_INSTRUCTIONS,
  LABEL_CLASSIFIER_MAX_OUTPUT_TOKENS,
  parseMatchingLabelIds,
  type AiLabelDefinition,
} from "@/lib/ai/labelClassifierOutput";
import { INCLUDED_WITH_HYPERTASK_GATEWAY_TAG, isSystemAiFeature } from "@/lib/aiUsageClassification";
import {
  parseSlackSummaryOutput,
  renderSlackSummaryComment,
  SLACK_SUMMARY_JSON_INSTRUCTIONS,
  SLACK_SUMMARY_MAX_OUTPUT_TOKENS,
  SLACK_SUMMARY_SYSTEM,
  slackSummaryPrompt,
} from "@/lib/slack/threadSummaryPrompt";

export const BATCH_PRICE_MULTIPLIER = 0.5;
export const BATCH_MAX_REQUESTS = 1000;
/** Gateway batches finish within 24h; one more hour of slack before the collector gives up. */
export const BATCH_STALE_MS = 25 * 60 * 60 * 1000;
/** Marks AiUsage rows as batch-priced. */
export const BATCH_USAGE_PROVIDER = "gateway-batch";

/**
 * Only platform-managed team keys batch. Batches skip the instant path's spend reservation, so the
 * capped shared key (free plan) stays instant, and a customer's own key stays on the existing path.
 */
export function batchEligibleFunding(source: "customer" | "managed" | "shared"): boolean {
  return source === "managed";
}

export type BatchKind = "slack-summary" | "smart-label";

export type SlackSummaryBatchItem = {
  threadId: string;
  taskIds: number[];
  projectId: number | null;
  lastMessageTsAtSubmit: string;
  participants: string[];
  permalink: string;
};

export type SmartLabelBatchItem = {
  taskId: number;
  projectId: number;
  labelId: string;
  /** The label prompt the request was built from; the apply step drops the verdict if it changed. */
  promptAtSubmit: string;
  /** ISO time of the task snapshot the request was built from (stale check). */
  snapshotAt: string;
};

export type BatchTextRequest = {
  id: string;
  type: "text";
  model: string;
  instructions: string;
  prompt: string;
  maxOutputTokens: number;
  providerOptions?: { gateway: { tags: string[] } };
};

/** Same gateway tags the instant path sends (see gatewayProviderOptionsForModel), without a model object. */
export function batchProviderOptions(
  feature: "summary" | "smart-label",
  tags: { teamId: string; projectId?: number | null; userId?: number | null },
): NonNullable<BatchTextRequest["providerOptions"]> {
  const gatewayTags: string[] = [feature];
  const systemFeature = isSystemAiFeature(feature);
  if (systemFeature) gatewayTags.push(INCLUDED_WITH_HYPERTASK_GATEWAY_TAG);
  gatewayTags.push(`team:${tags.teamId}`);
  if (tags.projectId != null) gatewayTags.push(`board:${tags.projectId}`);
  if (!systemFeature && tags.userId != null) gatewayTags.push(`user:${tags.userId}`);
  return { gateway: { tags: gatewayTags } };
}

export function buildSlackSummaryBatchRequest(args: {
  id: string;
  model: string;
  transcript: string;
  providerOptions?: BatchTextRequest["providerOptions"];
}): BatchTextRequest {
  return {
    id: args.id,
    type: "text",
    model: args.model,
    instructions: `${SLACK_SUMMARY_SYSTEM}\n\n${SLACK_SUMMARY_JSON_INSTRUCTIONS}`,
    prompt: slackSummaryPrompt(args.transcript),
    maxOutputTokens: SLACK_SUMMARY_MAX_OUTPUT_TOKENS,
    providerOptions: args.providerOptions,
  };
}

export function buildSmartLabelBatchRequest(args: {
  id: string;
  model: string;
  task: { title: string; description: string };
  definitions: AiLabelDefinition[];
  providerOptions?: BatchTextRequest["providerOptions"];
}): BatchTextRequest {
  return {
    id: args.id,
    type: "text",
    model: args.model,
    instructions: LABEL_CLASSIFIER_INSTRUCTIONS,
    prompt: labelClassifierPrompt(args.task, args.definitions),
    maxOutputTokens: LABEL_CLASSIFIER_MAX_OUTPUT_TOKENS,
    providerOptions: args.providerOptions,
  };
}

/** The gateway rejects a batch whose requests use different models; one batch per model. */
export function groupByKey<T>(entries: T[], keyOf: (entry: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return groups;
}

export function chunkForBatch<T>(entries: T[], size = BATCH_MAX_REQUESTS): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < entries.length; index += size) {
    chunks.push(entries.slice(index, index + size));
  }
  return chunks;
}

/** Half price: the normal token cost times 0.5. Unknown cost stays unknown. */
export function batchCostUsd(normalCostUsd: number | null | undefined): number | null {
  return typeof normalCostUsd === "number" && Number.isFinite(normalCostUsd)
    ? normalCostUsd * BATCH_PRICE_MULTIPLIER
    : null;
}

export type BatchItemOutcome =
  | {
      id: string;
      status: "succeeded";
      text: string;
      usage: {
        inputTokens: number;
        outputTokens: number;
        cachedInputTokens: number | null;
        cacheWriteInputTokens: number | null;
      };
    }
  | { id: string; status: "failed" | "cancelled" | "expired" };

type SdkItemResult = {
  id: string;
  status: string;
  text?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number };
  };
};

/** Maps the SDK's per-item results onto the stored items; an item with no result counts as failed. */
export function outcomesForItems(itemIds: string[], results: SdkItemResult[]): BatchItemOutcome[] {
  const byId = new Map(results.map((result) => [result.id, result]));
  return itemIds.map((id): BatchItemOutcome => {
    const result = byId.get(id);
    if (!result) return { id, status: "failed" };
    if (result.status === "succeeded" && typeof result.text === "string") {
      const details = result.usage?.inputTokenDetails;
      return {
        id,
        status: "succeeded",
        text: result.text,
        usage: {
          inputTokens: result.usage?.inputTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? 0,
          cachedInputTokens: details?.cacheReadTokens ?? null,
          cacheWriteInputTokens: details?.cacheWriteTokens ?? null,
        },
      };
    }
    return {
      id,
      status: result.status === "cancelled" || result.status === "expired" ? result.status : "failed",
    };
  });
}

export type SlackBatchAction =
  | { type: "comment"; html: string }
  /** Failed, expired, cancelled or unparsable: clear the pending mark and let the next cron try again. */
  | { type: "retry" };

export function slackActionForOutcome(
  outcome: BatchItemOutcome,
  item: Pick<SlackSummaryBatchItem, "participants" | "permalink">,
): SlackBatchAction {
  if (outcome.status !== "succeeded") return { type: "retry" };
  const summary = parseSlackSummaryOutput(outcome.text);
  if (!summary) return { type: "retry" };
  return { type: "comment", html: renderSlackSummaryComment(summary, item.participants, item.permalink) };
}

export type LabelBatchAction =
  | { type: "verdict"; matchingLabelIds: string[]; definitions: AiLabelDefinition[] }
  | { type: "skip" };

export function labelActionForOutcome(
  outcome: BatchItemOutcome,
  item: Pick<SmartLabelBatchItem, "labelId" | "promptAtSubmit">,
): LabelBatchAction {
  if (outcome.status !== "succeeded") return { type: "skip" };
  const definitions = [{ labelId: item.labelId, prompt: item.promptAtSubmit }];
  const matchingLabelIds = parseMatchingLabelIds(outcome.text.trim(), definitions);
  // Unparsable output is "no verdict", never "remove the label".
  return matchingLabelIds === null ? { type: "skip" } : { type: "verdict", matchingLabelIds, definitions };
}

/**
 * Only move the "summarized up to" mark forward. A newer message that arrived while the batch ran
 * keeps the thread due for another summary.
 */
export function nextSummarizedTs(current: string | null, submitted: string): string {
  if (!current) return submitted;
  const currentValue = Number.parseFloat(current);
  const submittedValue = Number.parseFloat(submitted);
  if (!Number.isFinite(currentValue)) return submitted;
  return Number.isFinite(submittedValue) && submittedValue > currentValue ? submitted : current;
}

export function isBatchStale(createdAt: Date, nowMs = Date.now()): boolean {
  return nowMs - createdAt.getTime() > BATCH_STALE_MS;
}

/** The AiUsage row for one succeeded result. `normalCostUsd` is the instant-call price; the row stores half. */
export function buildBatchUsageRow(args: {
  kind: BatchKind;
  userId: number;
  teamId: string;
  projectId: number | null;
  taskId: number | null;
  model: string;
  usage: Extract<BatchItemOutcome, { status: "succeeded" }>["usage"];
  normalCostUsd: number | null;
}) {
  const { usage } = args;
  return {
    userId: args.userId,
    teamId: args.teamId,
    projectId: args.projectId,
    taskId: args.taskId,
    provider: BATCH_USAGE_PROVIDER,
    model: args.model,
    feature: args.kind === "slack-summary" ? "summary" : "smart-label",
    outcome: "ok",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
    totalTokens: usage.inputTokens + usage.outputTokens,
    costUsd: batchCostUsd(args.normalCostUsd),
  };
}
