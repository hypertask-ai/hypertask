import { startGatewayBatch } from "@/lib/ai/batch/gatewayBatch";
import { batchIdempotencyKey, type BatchKind, type BatchTextRequest } from "@/lib/ai/batch/batchJobs";
import prisma from "@/lib/prisma";

/** Starts one gateway batch and records it for the collector. Returns the AiBatch row id. */
export async function submitBatch(args: {
  kind: BatchKind;
  teamId: string;
  userId: number;
  model: string;
  gatewayKey: string;
  requests: BatchTextRequest[];
  /** Request id -> what the collector applies when that result arrives. */
  items: Record<string, unknown>;
}): Promise<string> {
  const gatewayBatchId = await startGatewayBatch(
    args.gatewayKey,
    args.requests,
    batchIdempotencyKey(args.kind, args.teamId, args.requests),
  );
  // A replayed idempotent start returns the batch we already recorded, so this must not fail on it.
  const data = {
    gatewayBatchId,
    kind: args.kind,
    teamId: args.teamId,
    userId: args.userId,
    model: args.model,
    items: args.items as object,
  };
  const row = await prisma.aiBatch.upsert({
    where: { gatewayBatchId },
    create: data,
    update: {},
    select: { id: true },
  });
  return row.id;
}
