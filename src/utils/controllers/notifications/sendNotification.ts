import { sendEmail } from "@/lib/email/sendEmail";
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

/**
 *Function for setting up notification email types
 *The logic to decide whether to send email is where the function is being called
 * @param {TNotification} type
 * @param {INotificationBody} body
 * @return {*}
 */
export const sendEmailNotification = async (
  type: TNotification,
  body: INotificationBody
) => {
  // Task-scoped mail waits for the digest window, which drops it entirely if the
  // recipient reads the task in-app first. Doing this here rather than at each
  // call site is deliberate: this is the one function every email already routes
  // through, so no future sender can forget it.
  if (typeof body.userId === "number" && typeof body.taskId === "number") {
    if (await isTaskProjectMuted(body.userId, body.taskId)) return true;

    // The payload rides along so the digest can still send this exact email if
    // it later finds no Notification rows at all, which means the insert failed
    // rather than the user having read them.
    const bundled = await enqueueDigest(body.userId, body.taskId, {
      type,
      body: body as unknown as Record<string, unknown>,
    });
    if (bundled) return true;
  }

  try {
    const { subject, html } = renderNotificationEmail(type, body);
    const emailResponse = await sendEmail({
      to: body.recipient,
      from: `${body.sender} <notifications@hypertask.ai>`.trim(),
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
      // HTPR-4164: one-click unsubscribe. Set here rather than at each call site
      // for the same reason the digest hop is: this is the one function every
      // notification email already routes through.
      headers: unsubscribeHeaders(body.userId, body.recipient),
    });
    console.log(`🚀 ~ emailResponse ~ ${type}:`, emailResponse);
    return true;
  } catch (error) {
    console.log("🤔 ~ sendNotification ~ error:", error);
    return false;
  }
};
