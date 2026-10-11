import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { startGatewayBatch } from "@/lib/ai/batch/gatewayBatch";
import { batchIdempotencyKey, type BatchKind, type BatchTextRequest } from "@/lib/ai/batch/batchJobs";
import prisma from "@/lib/prisma";

/**
 * Starts one gateway batch and records it for the collector. Returns the AiBatch row id, or null
 * when `claim` got no items (nothing is recorded then).
 *
 * The row is created in the same transaction as `claim`, so the collector never sees a pending
 * batch whose work is not yet marked as waiting in it.
 */
export async function submitBatch(args: {
  kind: BatchKind;
  teamId: string;
  userId: number;
  model: string;
  gatewayKey: string;
  requests: BatchTextRequest[];
  /** Request id -> what the collector applies when that result arrives. */
  items: Record<string, unknown>;
  /** Runs inside the transaction with the new row id. Returns the item keys it actually claimed. */
  claim?: (tx: Prisma.TransactionClient, batchId: string) => Promise<string[]>;
}): Promise<string | null> {
  const gatewayBatchId = await startGatewayBatch(
    args.gatewayKey,
    args.requests,
    batchIdempotencyKey(args.kind, args.teamId, args.requests),
  );
  return prisma.$transaction(async (tx) => {
    // A replayed idempotent start returns a batch we already recorded.
    const existing = await tx.aiBatch.findUnique({ where: { gatewayBatchId }, select: { id: true } });
    if (existing) return existing.id;
    const id = randomUUID();
    const claimed = args.claim ? new Set(await args.claim(tx, id)) : null;
    const entries = Object.entries(args.items).filter(([key]) => !claimed || claimed.has(key));
    if (entries.length === 0) return null;
    await tx.aiBatch.create({
      data: {
        id,
        gatewayBatchId,
        kind: args.kind,
        teamId: args.teamId,
        userId: args.userId,
        model: args.model,
        items: Object.fromEntries(entries) as object,
      },
    });
    return id;
  });
}
