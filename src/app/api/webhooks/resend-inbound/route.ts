import { Webhook } from "svix";
import prisma from "@/lib/prisma";
import { retrieveResendReceivedEmail } from "@/lib/email/inboundReply";
import {
  createResendInboundHandler,
  type InboundDependencies,
} from "@/lib/email/inboundWebhookHandler";
import { createCommentService } from "@/utils/controllers/comments/createCommentService";
import { InboundEmailCommentDeletedError } from "@/utils/controllers/comments/inboundEmailReceipt";
import { broadcastTaskComment } from "@/lib/realtime/server";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

function webhookSecret(): string {
  const value = process.env.RESEND_WEBHOOK_SECRET;
  if (!value) throw new Error("RESEND_WEBHOOK_SECRET is not configured");
  return value;
}

function verifyResendWebhook(rawBody: string, headers: Headers): unknown {
  return new Webhook(webhookSecret()).verify(rawBody, {
    "svix-id": headers.get("svix-id") ?? "",
    "svix-timestamp": headers.get("svix-timestamp") ?? "",
    "svix-signature": headers.get("svix-signature") ?? "",
  });
}

const productionDependencies: InboundDependencies = {
  verify: verifyResendWebhook,
  retrieve: retrieveResendReceivedEmail,
  findUser: (userId) =>
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        photoURL: true,
      },
    }),
  findTask: (taskId, userId) =>
    prisma.task.findFirst({
      where: { id: taskId, project: taskWriteAccessWhere(userId) },
      select: { id: true, userId: true },
    }),
  createComment: async (input) => {
    try {
      await createCommentService(input);
      return true;
    } catch (error) {
      if (error instanceof InboundEmailCommentDeletedError) return false;
      throw error;
    }
  },
  broadcast: (taskId, userId) =>
    broadcastTaskComment(taskId, { originUserId: userId }),
};

export const POST = createResendInboundHandler(productionDependencies);
