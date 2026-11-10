import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { cancelGatewayBatch, startGatewayBatch } from "@/lib/ai/batch/gatewayBatch";
import { batchIdempotencyKey, type BatchKind, type BatchTextRequest } from "@/lib/ai/batch/batchJobs";
import prisma from "@/lib/prisma";

export async function submitBatch(args: {
  kind: BatchKind;
  teamId: string;
  userId: number;
  model: string;
  gatewayKey: string;
  requests: BatchTextRequest[];
  items: Record<string, unknown>;
  claim?: (tx: Prisma.TransactionClient, batchId: string) => Promise<string[]>;
}): Promise<string | null> {
  const { assertBatchWithinTeamCap } = await import("@/app/api/ai/_lib/batchCap");
  const { holdPlanBatch, rememberBatchGateway, releasePlanBatch } = await import("@/lib/ai/spend/batchHold");
  const idempotencyKey = batchIdempotencyKey(args.kind, args.teamId, args.requests);
  const drop = async (gatewayBatchId: string) => {
    await releasePlanBatch(idempotencyKey);
    await cancelGatewayBatch(args.gatewayKey, gatewayBatchId).catch(() => undefined);
  };
  await assertBatchWithinTeamCap({
    teamId: args.teamId,
    userId: args.userId,
    gatewayKey: args.gatewayKey,
  });
  await holdPlanBatch({ idempotencyKey, teamId: args.teamId, userId: args.userId, gatewayKey: args.gatewayKey, model: args.model, requests: args.requests });
  let gatewayBatchId: string;
  try {
    gatewayBatchId = await startGatewayBatch(args.gatewayKey, args.requests, idempotencyKey);
  } catch (error) {
    await releasePlanBatch(idempotencyKey);
    throw error;
  }
  try { await rememberBatchGateway(idempotencyKey, gatewayBatchId); }
  catch (error) { await drop(gatewayBatchId); throw error; }
  let savedId: string | null;
  try {
    savedId = await prisma.$transaction(async (tx) => {
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
  } catch (error) {
    const won = await prisma.aiBatch.findUnique({ where: { gatewayBatchId }, select: { id: true } }).catch(() => null);
    if (won?.id) return won.id;
    await drop(gatewayBatchId);
    throw error;
  }
  if (!savedId) await drop(gatewayBatchId);
  return savedId;
}
