import type { Prisma } from "@prisma/client";

/**
 * Correlating an agent's answer back to the request that invoked it.
 *
 * An agent-targeted `Mentioned` notification is the durable invocation record.
 * A comment mention stores the invoking comment on that row, so callers that
 * know the comment can point at it. A description mention has no comment at
 * all, so its only stable handle is the notification id itself (HTPR-5437).
 *
 * Both pointers address the same row. Accepting them together would let a
 * reply claim a request it was not answering, so exactly one is allowed.
 */
export interface AgentInvocationCorrelationInput {
  /** Invoking comment id, for a comment mention. */
  sourceCommentId?: number | null;
  /** Agent `Mentioned` notification id, for any mention including a description. */
  invocationId?: number | null;
}

export type AgentInvocationSelector =
  | { id: number }
  | { commentId: number };

export class ConflictingInvocationCorrelationError extends Error {
  constructor() {
    super(
      "Provide either reply_to_comment_id or reply_to_invocation_id, not both"
    );
    this.name = "ConflictingInvocationCorrelationError";
  }
}

export class DirectReplyAlreadyHandledError extends Error {
  constructor(readonly commentId: number) {
    super("Direct agent reply already handled");
    this.name = "DirectReplyAlreadyHandledError";
  }
}

export class AgentInvocationNotPendingError extends Error {
  constructor() {
    super("Agent invocation is no longer pending");
    this.name = "AgentInvocationNotPendingError";
  }
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

type AgentInvocationNotificationStore = Pick<
  Prisma.TransactionClient["notification"],
  "findFirst" | "updateMany" | "findUnique"
>;

/**
 * Returns the Prisma predicate that identifies the invoked request, or null
 * when the caller supplied no correlation. Routine agent comments carry none
 * and must never infer intent.
 */
export function buildAgentInvocationSelector({
  sourceCommentId,
  invocationId,
}: AgentInvocationCorrelationInput): AgentInvocationSelector | null {
  if (isPresent(sourceCommentId) && isPresent(invocationId)) {
    throw new ConflictingInvocationCorrelationError();
  }
  if (isPresent(invocationId)) return { id: invocationId };
  if (isPresent(sourceCommentId)) return { commentId: sourceCommentId };
  return null;
}

/** True when the reply names the exact request it answers. */
export function hasAgentInvocationCorrelation(
  input: AgentInvocationCorrelationInput
): boolean {
  return isPresent(input.sourceCommentId) || isPresent(input.invocationId);
}

/**
 * Atomically consumes one persisted request and returns its human requester.
 * A concurrent retry reuses the winning comment instead of posting twice.
 */
export async function claimPendingAgentInvocation({
  notifications,
  taskId,
  agentId,
  replyCommentId,
  hyperAiId,
  sourceCommentId,
  invocationId,
  consumedAt = new Date(),
}: {
  notifications: AgentInvocationNotificationStore;
  taskId: number;
  agentId: string;
  replyCommentId: number;
  hyperAiId: number;
  sourceCommentId?: number | null;
  invocationId?: number | null;
  consumedAt?: Date;
}): Promise<number | null> {
  const selector = buildAgentInvocationSelector({
    sourceCommentId,
    invocationId,
  });
  if (!selector) return null;

  const pending = await notifications.findFirst({
    where: {
      taskId,
      agentId,
      type: "Mentioned",
      status: "Normal",
      agentReplyConsumedAt: null,
      fromAgentId: null,
      fromUserId: { not: hyperAiId },
      ...selector,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      fromUserId: true,
      agentReplyConsumedAt: true,
      agentReplyCommentId: true,
    },
  });
  if (!pending || pending.fromUserId === null) {
    throw new AgentInvocationNotPendingError();
  }
  if (isPresent(pending.agentReplyCommentId)) {
    throw new DirectReplyAlreadyHandledError(pending.agentReplyCommentId);
  }

  const claimed = await notifications.updateMany({
    where: {
      id: pending.id,
      taskId,
      agentId,
      type: "Mentioned",
      status: "Normal",
      agentReplyConsumedAt: null,
      fromAgentId: null,
      fromUserId: pending.fromUserId,
      ...selector,
    },
    data: {
      agentReplyConsumedAt: consumedAt,
      agentReplyCommentId: replyCommentId,
      status: "Archive",
      archivedAt: consumedAt,
    },
  });
  if (claimed.count === 1) return pending.fromUserId;

  const winner = await notifications.findUnique({
    where: { id: pending.id },
    select: { agentReplyCommentId: true },
  });
  if (isPresent(winner?.agentReplyCommentId)) {
    throw new DirectReplyAlreadyHandledError(winner.agentReplyCommentId);
  }
  throw new AgentInvocationNotPendingError();
}
