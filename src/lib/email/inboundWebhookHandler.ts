import {
  buildInboundCommentHtml,
  normalizeSenderEmail,
  verifyInboundReplyAddress,
  type ResendReceivedEmail,
} from "@/lib/email/inboundReply";

interface ResendReceivedEvent {
  type: "email.received";
  data: {
    email_id: string;
    from: string;
    to: string[];
  };
}

interface InboundCommentInput {
  text: string;
  creatorId: number;
  taskId: number;
  ownerId: number;
  currentUser: {
    id: number;
    email: string;
    displayName: string | null;
    photoURL: string | null;
  };
  accessUserId: number;
  inboundEmailId: string;
}

export interface InboundDependencies {
  verify(rawBody: string, headers: Headers): unknown;
  retrieve(emailId: string): Promise<ResendReceivedEmail>;
  findUser(userId: number): Promise<{
    id: number;
    email: string;
    displayName: string | null;
    photoURL: string | null;
  } | null>;
  findTask(
    taskId: number,
    userId: number,
  ): Promise<{ id: number; userId: number } | null>;
  createComment(input: InboundCommentInput): Promise<boolean | void>;
  broadcast(taskId: number, userId: number): Promise<void>;
}

function isReceivedEvent(value: unknown): value is ResendReceivedEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<ResendReceivedEvent>;
  return Boolean(
    event.type === "email.received" &&
    event.data &&
    typeof event.data.email_id === "string" &&
    event.data.email_id.length > 0 &&
    event.data.email_id.length <= 128 &&
    typeof event.data.from === "string" &&
    Array.isArray(event.data.to) &&
    event.data.to.every((address) => typeof address === "string"),
  );
}

export function createResendInboundHandler(dependencies: InboundDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const rawBody = await request.text();
    let verified: unknown;
    try {
      verified = dependencies.verify(rawBody, request.headers);
    } catch {
      return Response.json({ received: false }, { status: 400 });
    }

    if (!isReceivedEvent(verified)) {
      return Response.json({ received: true });
    }

    try {
      const email = await dependencies.retrieve(verified.data.email_id);
      if (email.id !== verified.data.email_id) {
        throw new Error("Resend returned a different received email");
      }

      const webhookTargets = verified.data.to
        .map(verifyInboundReplyAddress)
        .filter((candidate) => candidate !== null);
      const retrievedTargets = email.to
        .map(verifyInboundReplyAddress)
        .filter((candidate) => candidate !== null);
      const replyTarget = webhookTargets.find((webhookTarget) =>
        retrievedTargets.some(
          (retrievedTarget) =>
            retrievedTarget.taskId === webhookTarget.taskId &&
            retrievedTarget.userId === webhookTarget.userId,
        ),
      );
      if (!replyTarget) {
        return Response.json({ received: true, ignored: "unknown recipient" });
      }

      const user = await dependencies.findUser(replyTarget.userId);
      if (!user) {
        return Response.json({ received: true, ignored: "missing target" });
      }

      const webhookSender = normalizeSenderEmail(verified.data.from);
      const retrievedSender = normalizeSenderEmail(email.from);
      const accountEmail = normalizeSenderEmail(user.email);
      // The unguessable signed recipient is the authorization proof. Resend's
      // receiving API does not expose a documented SPF, DKIM, DMARC, or trusted
      // envelope result. Matching both From copies to the account is an extra
      // check that also rejects a forwarded reply token. The address itself
      // carries an issue day and expires, so a leaked notification grants a
      // bounded window rather than permanent impersonation.
      if (
        !webhookSender ||
        !retrievedSender ||
        !accountEmail ||
        webhookSender !== accountEmail ||
        retrievedSender !== accountEmail
      ) {
        return Response.json({ received: true, ignored: "sender mismatch" });
      }

      const task = await dependencies.findTask(replyTarget.taskId, user.id);
      if (!task) {
        return Response.json({ received: true, ignored: "missing target" });
      }

      const text = buildInboundCommentHtml(email);
      if (!text) {
        return Response.json({ received: true, ignored: "empty reply" });
      }

      const commentExists = await dependencies.createComment({
        text,
        creatorId: user.id,
        taskId: task.id,
        ownerId: task.userId,
        currentUser: user,
        accessUserId: user.id,
        inboundEmailId: verified.data.email_id,
      });
      if (commentExists !== false) {
        await dependencies.broadcast(task.id, user.id);
      }

      return Response.json({ received: true });
    } catch (error) {
      console.error("Resend inbound email processing failed", error);
      return Response.json({ received: false }, { status: 500 });
    }
  };
}
