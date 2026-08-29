import type { Comment } from "@prisma/client";

export interface InboundEmailReceiptState {
  taskId: number;
  comment: Comment | null;
  processingStartedAt: Date | null;
  completedAt: Date | null;
}

export interface InboundEmailReceiptClient {
  inboundEmailReceipt: {
    findUnique(args: {
      where: { emailId: string };
      include: { comment: true };
    }): Promise<InboundEmailReceiptState | null>;
    create(args: {
      data: {
        emailId: string;
        taskId: number;
        commentId: number;
        processingStartedAt: Date;
      };
    }): Promise<unknown>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

export class InboundEmailProcessingInProgressError extends Error {
  constructor() {
    super("Inbound email processing is already in progress");
    this.name = "InboundEmailProcessingInProgressError";
  }
}

export class InboundEmailCommentDeletedError extends Error {
  constructor() {
    super("Inbound email comment was deleted");
    this.name = "InboundEmailCommentDeletedError";
  }
}

export function requireInboundEmailComment(
  receipt: InboundEmailReceiptState,
): Comment {
  if (!receipt.comment) throw new InboundEmailCommentDeletedError();
  return receipt.comment;
}

export async function findInboundEmailReceipt(
  client: InboundEmailReceiptClient,
  emailId: string,
  taskId: number,
): Promise<InboundEmailReceiptState | null> {
  const receipt = await client.inboundEmailReceipt.findUnique({
    where: { emailId },
    include: { comment: true },
  });
  if (!receipt) return null;
  if (receipt.taskId !== taskId) {
    throw new Error("Inbound email receipt belongs to another task");
  }
  return receipt;
}

export async function recordInboundEmailComment(
  client: InboundEmailReceiptClient,
  emailId: string,
  taskId: number,
  commentId: number,
  processingStartedAt: Date,
): Promise<void> {
  await client.inboundEmailReceipt.create({
    data: { emailId, taskId, commentId, processingStartedAt },
  });
}

export async function claimInboundEmailProcessing(
  client: InboundEmailReceiptClient,
  emailId: string,
  commentId: number,
  now: Date,
  staleBefore: Date,
): Promise<void> {
  const claimed = await client.inboundEmailReceipt.updateMany({
    where: {
      emailId,
      commentId,
      completedAt: null,
      OR: [
        { processingStartedAt: null },
        { processingStartedAt: { lt: staleBefore } },
      ],
    },
    data: { processingStartedAt: now },
  });
  if (claimed.count !== 1) {
    throw new InboundEmailProcessingInProgressError();
  }
}

export async function completeInboundEmailProcessing(
  client: InboundEmailReceiptClient,
  emailId: string,
  commentId: number,
  processingStartedAt: Date,
): Promise<void> {
  const completed = await client.inboundEmailReceipt.updateMany({
    where: {
      emailId,
      commentId,
      completedAt: null,
      processingStartedAt,
    },
    data: { completedAt: new Date(), processingStartedAt: null },
  });
  if (completed.count !== 1) {
    throw new Error("Inbound email receipt could not be completed");
  }
}

export async function releaseInboundEmailProcessing(
  client: InboundEmailReceiptClient,
  emailId: string,
  commentId: number,
  processingStartedAt: Date,
): Promise<void> {
  await client.inboundEmailReceipt.updateMany({
    where: {
      emailId,
      commentId,
      completedAt: null,
      processingStartedAt,
    },
    data: { processingStartedAt: null },
  });
}
