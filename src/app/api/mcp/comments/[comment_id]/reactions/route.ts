import { NextRequest } from 'next/server';
import { validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth';
import { requireRole } from '@/lib/mcp/agents/scopes';
import prisma from '@/lib/prisma';
import { findTaskByIdentifier } from '@/lib/mcp/tasks/resolveTask';
import {
  CommentReactionResult,
  CommentReactionTarget,
  createCommentReactionHandler,
} from '@/lib/mcp/comments/reactionHandler';
import { broadcastTaskComment } from '@/lib/realtime/server';
import checkReminderAndCreateNotification from '@/utils/controllers/notifications/creation-service/check-reminder_create-notification';
import { sendDataNewCommentFCM } from '@/utils/controllers/FCM';

const REACTION_LOCK_CLASS = 1_309_542_515;

function unifiedEmoji(emoji: string): string {
  return Array.from(emoji)
    .map((character) => character.codePointAt(0)!.toString(16))
    .join('-');
}

async function setReaction(
  target: CommentReactionTarget,
  userId: number,
  emoji: string,
  active: boolean
): Promise<CommentReactionResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(${REACTION_LOCK_CLASS}::int, ${target.commentId}::int)
    `;
    const unified = unifiedEmoji(emoji);
    const existing = await tx.reaction.findMany({
      where: { commentId: target.commentId, userId, unified },
      orderBy: { createdAt: 'asc' },
    });
    const wasActive = existing.some((reaction) => !reaction.isDeleted);
    let reaction: { id: string; emoji: string; userId: number } | null = null;

    if (active) {
      const saved = existing[0]
        ? await tx.reaction.update({
            where: { id: existing[0].id },
            data: {
              isDeleted: false,
              emoji,
              unified,
              names: [emoji],
              taskId: target.taskId,
              updatedAt: new Date(),
            },
            select: { id: true, emoji: true, userId: true },
          })
        : await tx.reaction.create({
            data: {
              emoji,
              unified,
              names: [emoji],
              commentId: target.commentId,
              taskId: target.taskId,
              userId,
            },
            select: { id: true, emoji: true, userId: true },
          });
      reaction = saved;
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
      where: { commentId: target.commentId, isDeleted: false },
      select: { id: true, emoji: true, userId: true },
      orderBy: { createdAt: 'asc' },
    });
    return { changed: wasActive !== active, reaction, reactions };
  });
}

async function notifyReaction(
  target: CommentReactionTarget,
  userId: number,
  emoji: string,
  active: boolean,
  result: CommentReactionResult
) {
  const sideEffects: Promise<unknown>[] = [
    broadcastTaskComment(target.taskId, { originUserId: userId }),
  ];
  if (result.changed && active && target.creatorId && target.creatorId !== userId) {
    sideEffects.push((async () => {
      await checkReminderAndCreateNotification(
        target.creatorId!,
        target.projectId,
        target.taskId,
        {
          commentId: target.commentId,
          taskId: target.taskId,
          reactionId: result.reaction?.id,
          userId: target.creatorId!,
          type: 'Reacted',
          projectId: target.projectId,
          fromUserId: userId,
        }
      );
      const devices = await prisma.subscribedDevices.findMany({
        where: { userId: target.creatorId! },
        include: { user: true },
      });
      await sendDataNewCommentFCM({
        type: 'newComment',
        notificationTitle: `Reacted ${emoji} on your comment`,
        notificationBody: target.text.replace(/<[^>]+>/g, '').slice(0, 500),
        devices,
        payload: '',
        taskTitle: '',
        afterAppDomain: `detail/project-${target.projectId}/${target.taskUniqueIndex}#comment-${target.commentId}`,
      });
    })());
  }
  const outcomes = await Promise.allSettled(sideEffects);
  outcomes.forEach((outcome) => {
    if (outcome.status === 'rejected') {
      console.error('[comment-reaction] notification side effect failed', outcome.reason);
    }
  });
}

export const POST = createCommentReactionHandler({
  checkRateLimit: checkMcpRateLimit,
  validateAuth: validateMcpAuth,
  authorizeWrite: async (ctx) => ctx.agentId ? requireRole(ctx, 'write') : null,
  actorUserId: (ctx) => ctx.user.id,
  findTarget: async (ctx, commentId) => {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        taskId: true,
        creatorId: true,
        text: true,
        task: { select: { projectId: true, uniqueIndex: true } },
      },
    });
    if (!comment) return null;
    const task = await findTaskByIdentifier(
      ctx.user,
      { task_id: comment.taskId, ticket_number: null, unique_index: null, project_id: null },
      ctx.agentId
    );
    if (!task) return null;
    return {
      commentId: comment.id,
      taskId: comment.taskId,
      projectId: comment.task.projectId,
      creatorId: comment.creatorId,
      text: comment.text,
      taskUniqueIndex: comment.task.uniqueIndex,
    };
  },
  setReaction,
  afterChange: notifyReaction,
});
