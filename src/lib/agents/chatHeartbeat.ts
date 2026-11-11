import type { PrismaClient } from "@prisma/client";

export async function refreshAgentChatHeartbeat(
  db: Pick<PrismaClient, "agent">,
  agentId: string,
  userId: number,
  now = new Date(),
): Promise<Date | null> {
  const where = { id: agentId, userId, revokedAt: null };
  const agent = await db.agent.findFirst({ where, select: { heartbeatAt: true } });
  if (!agent) return null;
  const cutoff = new Date(now.getTime() - 30_000);
  if (agent.heartbeatAt && agent.heartbeatAt > cutoff) return agent.heartbeatAt;
  const written = await db.agent.updateMany({
    where: { ...where, OR: [{ heartbeatAt: null }, { heartbeatAt: { lte: cutoff } }] },
    data: { heartbeatAt: now },
  });
  if (written.count === 1) return now;
  return (await db.agent.findFirst({ where, select: { heartbeatAt: true } }))?.heartbeatAt ?? null;
}
