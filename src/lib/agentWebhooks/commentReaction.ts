import prisma from "@/lib/prisma";
import { HTPR_7095_REACTION_WEBHOOK_FLAG } from "@/lib/flags/definitions/htpr-7095-reaction-webhook";
import type { AgentWebhookEventInput } from "./events";
import {
  persistAgentWebhookEvents,
  publishAgentWebhookDeliveries,
  resolveAgentWebhookActor,
} from "./outbox";

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

/**
 * Tell the agent that wrote a comment when a person reacts to it (HTPR-7095).
 * Never throws: the reaction is already stored. Gated on the reacting user.
 */
export async function emitCommentReactionWebhook(input: {
  commentId: number;
  reactorUserId: number;
  /** From the request auth: true only when an agent made the call. An agent's owner reacting as a person is false. */
  reactorIsAgent: boolean;
  emoji: string;
  added: boolean;
}): Promise<void> {
  try {
    if (!input.added) return;
    const { isFeatureEnabled } = await import("@/lib/flags");
    if (!(await isFeatureEnabled(HTPR_7095_REACTION_WEBHOOK_FLAG, input.reactorUserId))) return;

    const comment = await prisma.comment.findUnique({
      where: { id: input.commentId },
      select: {
        id: true,
        text: true,
        agentId: true,
        task: { select: { id: true, projectId: true, ticketNumber: true, title: true } },
      },
    });
    if (!comment?.agentId) return;
    const agentId = reactionWebhookTarget({
      added: input.added,
      reactorIsAgent: input.reactorIsAgent,
      commentAgentId: comment.agentId,
    });
    if (!agentId) return;

    const deliveryIds = await prisma.$transaction(async (tx) => {
      const actor = await resolveAgentWebhookActor(tx, { userId: input.reactorUserId });
      return persistAgentWebhookEvents(tx, {
        ...buildCommentReactionEvent({
          task: comment.task,
          actor,
          commentId: comment.id,
          commentText: comment.text,
          emoji: input.emoji,
        }),
        broadcast: false,
        agentIds: [agentId],
      });
    });
    await publishAgentWebhookDeliveries(deliveryIds);
  } catch (error) {
    console.error("[comment-reaction] agent webhook failed", error);
  }
}
