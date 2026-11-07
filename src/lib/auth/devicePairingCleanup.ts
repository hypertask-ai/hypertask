import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

export async function cleanupDevicePairings() {
  const now = new Date();
  const expired = await prisma.devicePairing.findMany({
    where: { state: "APPROVED", expiresAt: { lte: now } },
    orderBy: { expiresAt: "asc" }, take: 20,
    select: { id: true, agentId: true, tokenGeneration: true },
  });
  let denied = 0;
  for (const flow of expired) {
    denied += await prisma.$transaction(async tx => {
      const changed = await tx.devicePairing.updateMany({
        where: { id: flow.id, state: "APPROVED", expiresAt: { lte: now } },
        data: { state: "DENIED", credential: null, deliveryResult: null, deliveryRetryUntil: null },
      });
      if (changed.count !== 1) return 0;
      if (flow.agentId && flow.tokenGeneration) {
        await tx.agent.updateMany({
          where: { id: flow.agentId, mcpTokenJti: flow.tokenGeneration },
          data: { mcpTokenHash: null, mcpTokenJti: null, revokedAt: now },
        });
        await tx.agent.updateMany({ where: { id: flow.agentId, devicePairingId: flow.id }, data: { devicePairingId: null } });
      }
      return 1;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  const cleared = await prisma.devicePairing.updateMany({
    where: { deliveryRetryUntil: { lte: now } },
    data: { deliveryResult: null, deliveryRetryUntil: null },
  });
  const removed = await prisma.devicePairing.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } } });
  return { denied, cleared: cleared.count, removed: removed.count };
}
