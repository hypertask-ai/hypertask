import { sendEmail } from "@/lib/email/sendEmail";
import { HTPR_7031_INVITE_EMAIL_FLAG, isFeatureEnabled } from "@/lib/flags";
import {
  renderNotificationEmail,
  type INotificationBody,
  type TNotification,
} from "./emailTemplates";
import { enqueueDigest } from "./digest";
import { unsubscribeHeaders } from "@/lib/email/unsubscribe";
import { isTaskProjectMuted } from "./projectMute";
import { createNotificationReplyAddress } from "@/lib/email/inboundReply";

export type { INotificationBody, TNotification } from "./emailTemplates";

export const sendEmailNotification = async (
  type: TNotification,
  body: INotificationBody
) => {
  if (typeof body.userId === "number" && typeof body.taskId === "number") {
    if (await isTaskProjectMuted(body.userId, body.taskId)) return true;

    const bundled = await enqueueDigest(body.userId, body.taskId, {
      type,
      body: body as unknown as Record<string, unknown>,
    });
    if (bundled) return true;
  }

  try {
    const inviteContext = type === "Invite" &&
      await isFeatureEnabled(HTPR_7031_INVITE_EMAIL_FLAG, body.senderUserId ?? 0);
    if (inviteContext) {
      const prefix = body.senderEmail?.split("@")[0]?.toLowerCase();
      const sender = [body.sender, body.senderName]
        .map((name) => name?.trim())
        .find((name) => name && name.toLowerCase() !== prefix) ?? "A teammate";
      body = { ...body, sender };
    }
    const { subject, html } = renderNotificationEmail(type, body, inviteContext);
    const emailResponse = await sendEmail({
      to: body.recipient,
      from: `${inviteContext ? JSON.stringify(body.sender) : body.sender} <notifications@hypertask.ai>`.trim(),
      replyTo:
        typeof body.userId === "number" &&
        typeof (body.replyTaskId ?? body.taskId) === "number"
          ? createNotificationReplyAddress(
              body.replyTaskId ?? body.taskId!,
              body.userId,
            )
          : undefined,
      subject,
      html,
      headers: unsubscribeHeaders(body.userId, body.recipient),
    });
    console.log(`🚀 ~ emailResponse ~ ${type}:`, emailResponse);
    return true;
  } catch (error) {
    console.log("🤔 ~ sendNotification ~ error:", error);
    return false;
  }
};
