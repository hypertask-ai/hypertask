import { createHash } from "node:crypto";

import { getRedis } from "@/lib/redis";

const PREVIEW_TTL_SECONDS = 900;
const COMMENT_ORIGIN_TTL_SECONDS = PREVIEW_TTL_SECONDS;

type ConfirmationRedis = {
  del(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  getdel(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    expiryMode: "EX",
    ttlSeconds: number
  ): Promise<unknown>;
};

type HyperAiConfirmationInput = {
  userId: number;
  sessionId: string;
  operationKey: string;
  sourceMessageId: string;
  sourceMessageText: string;
  sourceMessageCreatedAt: Date | null;
  sourceMessageImmutable?: boolean;
  confirmed?: boolean;
  previewsIssuedThisRequest: Set<string>;
  getRedisClient?: () => Promise<ConfirmationRedis>;
};

type HyperAiCommentOriginInput = {
  commentId: number;
  userId: number;
  taskId: number;
  agentId: string | null;
  text: string;
  createdAt: Date;
  getRedisClient?: () => Promise<ConfirmationRedis>;
};

function commentOriginKey(commentId: number) {
  return `hyperai_comment_origin:${commentId}`;
}

/**
 * A comment that has entered any edit path can never be immutable again. The
 * receipt is removed before the database write, so edit-and-restore cannot
 * recreate approval eligibility by returning to the original text.
 */
export async function invalidateHyperAiCommentOrigin(
  commentId: number,
  getRedisClient: () => Promise<ConfirmationRedis> = getRedis,
): Promise<void> {
  const redis = await getRedisClient();
  await redis.del(commentOriginKey(commentId));
}

function commentTextHash(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Record the immutable creation payload while the shared comment-create
 * controller still owns it. Comment rows do not have updatedAt, so approval
 * later compares the live row against this short-lived server-side receipt.
 */
export async function recordHyperAiCommentOrigin({
  commentId,
  userId,
  taskId,
  agentId,
  text,
  createdAt,
  getRedisClient = getRedis,
}: HyperAiCommentOriginInput): Promise<void> {
  const redis = await getRedisClient();
  await redis.set(
    commentOriginKey(commentId),
    JSON.stringify({
      userId,
      taskId,
      agentId,
      textHash: commentTextHash(text),
      createdAt: createdAt.getTime(),
    }),
    "EX",
    COMMENT_ORIGIN_TTL_SECONDS,
  );
}

export async function isUneditedHyperAiComment({
  commentId,
  userId,
  taskId,
  agentId,
  text,
  createdAt,
  getRedisClient = getRedis,
}: HyperAiCommentOriginInput): Promise<boolean> {
  try {
    const redis = await getRedisClient();
    const raw = await redis.get(commentOriginKey(commentId));
    if (!raw) return false;
    const receipt = JSON.parse(raw) as {
      userId?: unknown;
      taskId?: unknown;
      agentId?: unknown;
      textHash?: unknown;
      createdAt?: unknown;
    };
    return (
      receipt.userId === userId &&
      receipt.taskId === taskId &&
      agentId === null &&
      receipt.agentId === null &&
      receipt.textHash === commentTextHash(text) &&
      receipt.createdAt === createdAt.getTime()
    );
  } catch {
    return false;
  }
}

export function isExplicitHyperAiApproval(text: string) {
  const normalized = text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/^\s*@?hyperai\b[\s,:-]*/i, "")
    .trim();
  return /^(?:yes|yes,?\s+(?:please\s+)?(?:proceed|do it)|confirm(?:ed)?|approve(?:d)?|go ahead|do it|proceed)[.!]?$/i.test(
    normalized,
  );
}

function parsePreview(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as {
      sourceMessageId?: unknown;
      previewedAt?: unknown;
    };
    return typeof parsed.sourceMessageId === "string" &&
      typeof parsed.previewedAt === "number"
      ? {
          sourceMessageId: parsed.sourceMessageId,
          previewedAt: parsed.previewedAt,
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * HyperAI write confirmation is tied to server-validated message identity.
 * A distinct later message must explicitly approve the stored proposal before
 * GETDEL consumes it, so replays and same-message model calls stay read-only.
 */
export async function requireHyperAiCommentConfirmation({
  userId,
  sessionId,
  operationKey,
  sourceMessageId,
  sourceMessageText,
  sourceMessageCreatedAt,
  sourceMessageImmutable = false,
  confirmed,
  previewsIssuedThisRequest,
  getRedisClient = getRedis,
}: HyperAiConfirmationInput): Promise<"preview" | "proceed"> {
  const operationHash = createHash("sha256").update(operationKey).digest("hex");
  const tokenKey = `hyperai_confirm:${userId}:${sessionId}:${operationHash}`;
  const sessionProposalKey = `hyperai_confirm_active:${userId}:${sessionId}`;
  const previewValue = JSON.stringify({
    sourceMessageId,
    previewedAt: Date.now(),
  });
  const activeProposalValue = JSON.stringify({ operationHash, tokenKey });

  try {
    const redis = await getRedisClient();
    const recordPreview = async () => {
      previewsIssuedThisRequest.add(operationKey);
      await redis.set(tokenKey, previewValue, "EX", PREVIEW_TTL_SECONDS);
      // A plain human approval can only refer to one proposal. Publishing a
      // new proposal replaces the session pointer, so older operation tokens
      // cannot also consume the same later approval comment.
      await redis.set(
        sessionProposalKey,
        activeProposalValue,
        "EX",
        PREVIEW_TTL_SECONDS,
      );
      return "preview" as const;
    };

    if (previewsIssuedThisRequest.has(operationKey) || !confirmed) {
      return recordPreview();
    }
    if (!isExplicitHyperAiApproval(sourceMessageText)) return "preview";
    if (
      !sourceMessageImmutable ||
      !sourceMessageId.startsWith("comment:") ||
      !sourceMessageCreatedAt
    ) {
      return "preview";
    }

    const proposal = parsePreview(await redis.get(tokenKey));
    if (!proposal) return recordPreview();
    if (proposal.sourceMessageId === sourceMessageId) return "preview";
    if (sourceMessageCreatedAt.getTime() <= proposal.previewedAt) return "preview";

    const activeProposal = await redis.get(sessionProposalKey);
    if (activeProposal !== activeProposalValue) return recordPreview();
    const consumedActiveProposal = await redis.getdel(sessionProposalKey);
    if (consumedActiveProposal !== activeProposalValue) return "preview";

    const consumed = parsePreview(await redis.getdel(tokenKey));
    return consumed?.sourceMessageId === proposal.sourceMessageId &&
      consumed.previewedAt === proposal.previewedAt
      ? "proceed"
      : "preview";
  } catch {
    previewsIssuedThisRequest.add(operationKey);
    return "preview";
  }
}
