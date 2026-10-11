import type { Prisma } from '@prisma/client';

/** HTPR-7122: the agent behind an agent-token reaction, or null for a person. */
export type ReactionAgent = { id: string; displayName: string | null };

export type StoredCommentReaction = {
  id: string;
  emoji: string;
  userId: number;
  agentId: string | null;
  agentDisplayName: string | null;
};

const REACTION_SELECT = {
  id: true,
  emoji: true,
  userId: true,
  agentId: true,
  agentDisplayName: true,
} as const;

export function unifiedEmoji(emoji: string): string {
  return Array.from(emoji)
    .map((character) => character.codePointAt(0)!.toString(16))
    .join('-');
}

/**
 * Sets one reactor's emoji on a comment, inside the caller's transaction.
 * The reactor is the person (agentId null) or one agent of that person. Their rows
 * are kept apart, so an agent removing its reaction never removes its owner's,
 * and the owner never toggles the agent's.
 */
export async function writeCommentReaction(
  tx: Prisma.TransactionClient,
  input: {
    commentId: number;
    taskId: number;
    userId: number;
    agent: ReactionAgent | null;
    emoji: string;
    active: boolean;
  }
): Promise<{
  wasActive: boolean;
  reaction: StoredCommentReaction | null;
  reactions: StoredCommentReaction[];
}> {
  const { commentId, taskId, userId, agent, emoji, active } = input;
  const unified = unifiedEmoji(emoji);
  const agentId = agent?.id ?? null;
  const existing = await tx.reaction.findMany({
    where: { commentId, userId, unified, agentId },
    orderBy: { createdAt: 'asc' },
  });
  const wasActive = existing.some((reaction) => !reaction.isDeleted);
  let reaction: StoredCommentReaction | null = null;

  if (active) {
    const agentFields = agent ? { agentId: agent.id, agentDisplayName: agent.displayName } : {};
    reaction = existing[0]
      ? await tx.reaction.update({
          where: { id: existing[0].id },
          data: {
            isDeleted: false,
            emoji,
            unified,
            names: [emoji],
            taskId,
            updatedAt: new Date(),
            ...agentFields,
          },
          select: REACTION_SELECT,
        })
      : await tx.reaction.create({
          data: {
            emoji,
            unified,
            names: [emoji],
            commentId,
            taskId,
            userId,
            ...agentFields,
          },
          select: REACTION_SELECT,
        });
    if (existing.length > 1) {
      await tx.reaction.updateMany({
        where: { id: { in: existing.slice(1).map((item) => item.id) } },
        data: { isDeleted: true, updatedAt: new Date() },
      });
    }
  } else if (existing.length > 0) {
    await tx.reaction.updateMany({
      where: { id: { in: existing.map((item) => item.id) } },
      data: { isDeleted: true, updatedAt: new Date() },
    });
  }

  const reactions = await tx.reaction.findMany({
    where: { commentId, isDeleted: false },
    select: REACTION_SELECT,
    orderBy: { createdAt: 'asc' },
  });
  return { wasActive, reaction, reactions };
}
