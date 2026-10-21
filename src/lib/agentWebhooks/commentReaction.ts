import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { HTPR_7095_REACTION_WEBHOOK_FLAG } from "@/lib/flags/definitions/htpr-7095-reaction-webhook";
import type { AgentWebhookEventInput } from "./events";
import { persistAgentWebhookEvents, resolveAgentWebhookActor } from "./outbox";

const EXCERPT_LIMIT = 200;

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
  reactorIsAgent: boolean;
  reactorAgentId?: string | null;
  emoji: string;
  added: boolean;
};

type PreparedCommentReactionWebhook = {
  agentId: string;
  comment: { id: number; text: string | null; task: { id: number; projectId: number; ticketNumber: string | null; title: string } };
};

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

export async function persistCommentReactionWebhook(
  tx: Prisma.TransactionClient,
  prepared: PreparedCommentReactionWebhook,
  input: CommentReactionWebhookInput,
): Promise<string[]> {
  const actor = await resolveAgentWebhookActor(tx, {
    userId: input.reactorUserId,
    agentId: input.reactorAgentId ?? null,
  });
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
