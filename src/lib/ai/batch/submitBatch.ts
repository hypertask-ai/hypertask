import { startGatewayBatch } from "@/lib/ai/batch/gatewayBatch";
import type { BatchKind, BatchTextRequest } from "@/lib/ai/batch/batchJobs";
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
  const gatewayBatchId = await startGatewayBatch(args.gatewayKey, args.requests);
  const row = await prisma.aiBatch.create({
    data: {
      gatewayBatchId,
      kind: args.kind,
      teamId: args.teamId,
      userId: args.userId,
      model: args.model,
      items: args.items as object,
    },
    select: { id: true },
  });
  return row.id;
}
