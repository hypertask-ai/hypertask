import type { Prisma } from '@prisma/client';

const REACTION_LOCK_CLASS = 1_309_542_515;

export async function lockCommentReactions(tx: Prisma.TransactionClient, commentId: number): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(${REACTION_LOCK_CLASS}::int, ${commentId}::int)
  `;
}
