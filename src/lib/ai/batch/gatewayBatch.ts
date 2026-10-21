import {
  createGateway,
  experimental_cancelBatch as cancelBatch,
  experimental_getBatchResults as getBatchResults,
  experimental_getBatchStatus as getBatchStatus,
  experimental_startBatch as startBatch,
} from "ai";

import { outcomesForItems, type BatchItemOutcome, type BatchTextRequest } from "@/lib/ai/batch/batchJobs";

function provider(gatewayKey: string) {
  return createGateway({ apiKey: gatewayKey });
}

function referenceFor(gatewayKey: string, id: string) {
  return { version: 2 as const, id, provider: provider(gatewayKey).experimental_batch().provider };
}

export async function startGatewayBatch(
  gatewayKey: string,
  requests: BatchTextRequest[],
  idempotencyKey: string,
): Promise<string> {
  const started = await startBatch({
    provider: provider(gatewayKey),
    requests,
    providerOptions: { gateway: { idempotencyKey } },
  });
  return started.id;
}

export async function gatewayBatchState(gatewayKey: string, id: string): Promise<"pending" | "completed" | "failed"> {
  const status = await getBatchStatus({ provider: provider(gatewayKey), batch: referenceFor(gatewayKey, id) });
  return status.status;
}

export async function gatewayBatchOutcomes(gatewayKey: string, id: string, itemIds: string[]): Promise<BatchItemOutcome[]> {
  const results = [];
  for await (const item of getBatchResults({ provider: provider(gatewayKey), batch: referenceFor(gatewayKey, id) })) {
    if (item.type === "text") results.push(item);
  }
  return outcomesForItems(itemIds, results);
}

export async function cancelGatewayBatch(gatewayKey: string, id: string): Promise<void> {
  await cancelBatch({ provider: provider(gatewayKey), batch: referenceFor(gatewayKey, id) });
}
