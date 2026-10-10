import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { HTPR_7095_REACTION_WEBHOOK_FLAG } from "@/lib/flags/definitions/htpr-7095-reaction-webhook";
import type { AgentWebhookEventInput } from "./events";
import { persistAgentWebhookEvents, resolveAgentWebhookActor } from "./outbox";

const EXCERPT_LIMIT = 200;

/** Plain text start of a comment, at most 200 characters. */
export function commentExcerpt(html: string | null | undefined): string {
  const text = String(html ?? "")
    .slice(0, 20000)
    .replace(/<(?:br|\/p|\/li|\/div)[^<>]{0,200}>/gi, " ")
    .replace(/<[^<>]{0,2000}>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= EXCERPT_LIMIT ? text : `${text.slice(0, EXCERPT_LIMIT - 3)}...`;
}

/**
 * Rules: only an ADDED reaction, only by a person, only on an agent's comment.
 * Returns the agent to tell, or null.
 */
export function reactionWebhookTarget(input: {
  added: boolean;
  reactorIsAgent: boolean;
  commentAgentId: string | null | undefined;
}): string | null {
  if (!input.added || input.reactorIsAgent) return null;
  return input.commentAgentId || null;
}

export function buildCommentReactionEvent(input: {
  task: { id: number; projectId: number; ticketNumber: string | null; title: string | null };
  actor: AgentWebhookEventInput["actor"];
  commentId: number;
  commentText: string | null | undefined;
  emoji: string;
}): Omit<AgentWebhookEventInput, "agentId" | "projectId"> & { projectId: number } {
  return {
    event: "comment.reaction",
    projectId: input.task.projectId,
    taskId: input.task.id,
    ticketNumber: input.task.ticketNumber,
    taskTitle: input.task.title,
    actor: input.actor,
    commentId: input.commentId,
    emoji: input.emoji,
    commentExcerpt: commentExcerpt(input.commentText),
  };
}

export type CommentReactionWebhookInput = {
  commentId: number;
  reactorUserId: number;
  /** From the request auth: true only when an agent made the call. An agent's owner reacting as a person is false. */
  reactorIsAgent: boolean;
  emoji: string;
  added: boolean;
};

type PreparedCommentReactionWebhook = {
  agentId: string;
  comment: { id: number; text: string | null; task: { id: number; projectId: number; ticketNumber: string | null; title: string } };
};

/**
 * Read-only part, run before the reaction is written: flag, comment author agent and target.
 * Returns null when no agent should hear about this reaction.
 */
export async function prepareCommentReactionWebhook(
  input: CommentReactionWebhookInput,
): Promise<PreparedCommentReactionWebhook | null> {
  if (!input.added) return null;
  const { isFeatureEnabled } = await import("@/lib/flags");
  if (!(await isFeatureEnabled(HTPR_7095_REACTION_WEBHOOK_FLAG, input.reactorUserId))) return null;
  const comment = await prisma.comment.findUnique({
    where: { id: input.commentId },
    select: {
      id: true,
      text: true,
      agentId: true,
      task: { select: { id: true, projectId: true, ticketNumber: true, title: true } },
    },
  });
  if (!comment?.agentId) return null;
  const agentId = reactionWebhookTarget({
    added: input.added,
    reactorIsAgent: input.reactorIsAgent,
    commentAgentId: comment.agentId,
  });
  return agentId ? { agentId, comment } : null;
}

/**
 * Write the outbox row inside the caller's reaction transaction, so a stored reaction always has its event.
 * Publish the returned delivery ids after the transaction commits.
 */
export async function persistCommentReactionWebhook(
  tx: Prisma.TransactionClient,
  prepared: PreparedCommentReactionWebhook,
  input: CommentReactionWebhookInput,
): Promise<string[]> {
  const actor = await resolveAgentWebhookActor(tx, { userId: input.reactorUserId });
  return persistAgentWebhookEvents(tx, {
    ...buildCommentReactionEvent({
      task: prepared.comment.task,
      actor,
      commentId: prepared.comment.id,
      commentText: prepared.comment.text,
      emoji: input.emoji,
    }),
    broadcast: false,
    agentIds: [prepared.agentId],
  });
}
