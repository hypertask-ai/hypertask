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
import { writeCommentReaction, type ReactionAgent } from '@/lib/mcp/comments/reactionStore';
import { mapMcpCommentReaction, reactionAgentIds } from '@/lib/mcp/comments/reactionResponse';
import { loadVisibleReactionAgents } from '@/lib/mcp/comments/visibleReactionAgents';
import { persistCommentReactionWebhook, prepareCommentReactionWebhook } from '@/lib/agentWebhooks/commentReaction';
import { publishAgentWebhookDeliveries } from '@/lib/agentWebhooks/outbox';
import { broadcastTaskComment } from '@/lib/realtime/server';
import checkReminderAndCreateNotification from '@/utils/controllers/notifications/creation-service/check-reminder_create-notification';
import { sendDataNewCommentFCM } from '@/utils/controllers/FCM';

const REACTION_LOCK_CLASS = 1_309_542_515;

async function reactionAgent(agentId: string | null): Promise<ReactionAgent | null> {
  if (!agentId) return null;
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { displayName: true } });
  return { id: agentId, displayName: agent?.displayName?.trim() || null };
}

async function setReaction(
  target: CommentReactionTarget,
  userId: number,
  emoji: string,
  active: boolean,
  agentId: string | null
): Promise<CommentReactionResult> {
  // HTPR-7122: an agent token reacts as the agent. userId stays the owner, for access only.
  const agent = await reactionAgent(agentId);
  // HTPR-7095: a newly added reaction and its agent webhook outbox row are written together, then published after commit.
  const webhookInput = {
    commentId: target.commentId,
    reactorUserId: userId,
    reactorIsAgent: Boolean(agent),
    reactorAgentId: agent?.id ?? null,
    emoji,
    added: active,
  };
  // A failed lookup fails the request before anything is stored, so the client retry keeps the event.
  const preparedWebhook = await prepareCommentReactionWebhook(webhookInput);
  let deliveryIds: string[] = [];
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(${REACTION_LOCK_CLASS}::int, ${target.commentId}::int)
    `;
    const { wasActive, reaction, reactions } = await writeCommentReaction(tx, {
      commentId: target.commentId,
      taskId: target.taskId,
      userId,
      agent,
      emoji,
      active,
    });
    if (preparedWebhook && !wasActive && active) {
      deliveryIds = await persistCommentReactionWebhook(tx, preparedWebhook, webhookInput);
    }
    return { changed: wasActive !== active, reaction, reactions };
  });
  await publishAgentWebhookDeliveries(deliveryIds).catch((error) => {
    // The outbox row is stored; the outbox retry delivers it later.
    console.error('[comment-reaction] agent webhook publish failed', error);
  });
  // HTPR-7122: the response names only agents the caller may see, like the comment reads.
  const visibleAgents = await loadVisibleReactionAgents(
    reactionAgentIds([{ reactions: result.reactions }]),
    userId,
    target.projectId
  );
  return {
    changed: result.changed,
    reaction: result.reaction && mapMcpCommentReaction(result.reaction, visibleAgents),
    reactions: result.reactions.map((row) => mapMcpCommentReaction(row, visibleAgents)),
  };
}

async function notifyReaction(
  target: CommentReactionTarget,
  userId: number,
  emoji: string,
  active: boolean,
  result: CommentReactionResult,
  agentId: string | null
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
          // HTPR-7122: the inbox names the agent, never its owner, as the reactor.
          ...(agentId ? { fromAgentId: agentId } : {}),
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
  setReaction: (target, userId, emoji, active, ctx) =>
    setReaction(target, userId, emoji, active, ctx.agentId ?? null),
  afterChange: (target, userId, emoji, active, result, ctx) =>
    notifyReaction(target, userId, emoji, active, result, ctx.agentId ?? null),
});
