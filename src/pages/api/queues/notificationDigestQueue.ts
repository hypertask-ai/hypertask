import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { withQstashSignature } from "@/lib/qstash";
import { sendEmail } from "@/lib/email/sendEmail";
import { unsubscribeHeaders } from "@/lib/email/unsubscribe";
import {
  renderDigestEmail,
  renderNotificationEmail,
  type IDigestEvent,
  type INotificationBody,
  type TNotification,
} from "@/utils/controllers/notifications/emailTemplates";
import { resolveNotificationChannelPreference } from "@/utils/controllers/notifications/shouldNotify";
import {
  dedupePerComment,
  verbByType,
} from "@/utils/controllers/notifications/digestEvents";
import {
  clearDigestWindow,
  getDigestFallback,
  getLastDigestedAt,
  setLastDigestedAt,
  type DigestJobBody,
} from "@/utils/controllers/notifications/digest";
import { isTaskProjectMuted } from "@/utils/controllers/notifications/projectMute";
import { createNotificationReplyAddress } from "@/lib/email/inboundReply";

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASEURL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
  );
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { userId, taskId, since } = (req.body ?? {}) as Partial<DigestJobBody>;

  if (typeof userId !== "number" || typeof taskId !== "number" || !since) {
    return res.status(200).json({ ok: false, reason: "malformed job body" });
  }

  try {
    if (await isTaskProjectMuted(userId, taskId)) {
      await clearDigestWindow(userId, taskId);
      return res
        .status(200)
        .json({ ok: true, sent: false, reason: "board muted" });
    }

    // Never look further back than the newest event already emailed. Without
    // this floor an event arriving late in one window falls inside the next
    // window's backdated start and gets sent twice, and a QStash redelivery
    // re-sends the entire batch.
    const watermark = await getLastDigestedAt(userId, taskId);
    const jobSince = new Date(since);
    const effectiveSince =
      watermark && watermark > jobSince ? watermark : jobSince;

    const [recipient, task, notifications] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          displayName: true,
          UserSetting: {
            select: {
              notification: true,
              notificationMatrix: true,
              notificationPreference: true,
            },
          },
        },
      }),
      prisma.task.findUnique({
        where: { id: taskId },
        select: { title: true, projectId: true, uniqueIndex: true },
      }),
      prisma.notification.findMany({
        // seen flips to true the moment the user opens the task, so an unseen
        // row is exactly "they have not read this yet".
        //
        // Normal-only is deliberate, and it is the one place this changes old
        // behaviour. A row is Archive either because the user dismissed it from
        // the inbox (markAsDone) or because a DurationComplete reminder snoozed
        // the task. Both mean the user has already dealt with it, so neither
        // should produce mail; previously the snoozed case still sent one.
        where: {
          userId,
          taskId,
          seen: false,
          status: "Normal",
          createdAt: { gt: effectiveSince },
        },
        orderBy: { createdAt: "asc" },
        select: {
          createdAt: true,
          type: true,
          commentId: true,
          fromUser: { select: { displayName: true } },
          fromAgent: { select: { displayName: true } },
          comment: { select: { text: true } },
        },
      }),
    ]);

    if (notifications.length === 0) {
      // Zero unseen rows has two very different causes, and only one of them
      // means "stay quiet". Count the window ignoring seen and status: if rows
      // exist, they were read or dismissed and no email is correct. If none
      // exist, the insert failed, and before the digest this email would still
      // have gone out — so send the payload the window was holding.
      const everExisted = await prisma.notification.count({
        where: { userId, taskId, createdAt: { gt: effectiveSince } },
      });

      if (everExisted > 0) {
        await clearDigestWindow(userId, taskId);
        return res
          .status(200)
          .json({ ok: true, sent: false, reason: "all read" });
      }

      const sentFallback = await sendFallback(userId, taskId);
      await clearDigestWindow(userId, taskId);
      return res
        .status(200)
        .json({ ok: true, sent: sentFallback, reason: "no notification row" });
    }

    if (!recipient?.email || !recipient.UserSetting || !task) {
      await clearDigestWindow(userId, taskId);
      return res
        .status(200)
        .json({ ok: false, reason: "recipient or task missing" });
    }

    // Re-apply the matrix per row. A window can hold event types the user wants
    // by email and types they do not; only the opted-in ones may be bundled.
    const setting = recipient.UserSetting;
    const allowed = notifications.filter((notification) =>
      resolveNotificationChannelPreference(setting, notification.type, "email")
    );

    const events: IDigestEvent[] = dedupePerComment(allowed).map(
      (notification) => {
        // `??` alone would keep an empty display name, which now leads the
        // subject line rather than sitting inside a bullet.
        const actor =
          notification.fromUser?.displayName?.trim() ||
          notification.fromAgent?.displayName?.trim() ||
          "Someone";
        return {
          line: `${actor} ${verbByType[notification.type]}`,
          commentText: notification.comment?.text ?? undefined,
          isMention: notification.type === "Mentioned",
          actor,
        };
      }
    );

    if (events.length === 0) {
      await clearDigestWindow(userId, taskId);
      return res
        .status(200)
        .json({ ok: true, sent: false, reason: "no opted-in events" });
    }

    const link = `${baseUrl()}/detail/project-${task.projectId}/${task.uniqueIndex}`;
    const { subject, html } = renderDigestEmail(
      task.title,
      link,
      events,
      recipient.displayName ?? undefined
    );

    await sendEmail({
      to: recipient.email,
      from: "Hypertask <notifications@hypertask.ai>",
      replyTo: createNotificationReplyAddress(taskId, userId),
      subject,
      html,
      // HTPR-4164: the digest is notification mail too, so it carries the same
      // one-click unsubscribe as the per-event path.
      headers: unsubscribeHeaders(userId, recipient.email),
    });

    // Only after a confirmed send. Moving the watermark first would let a failed
    // send skip these events on the retry.
    const newest = notifications[notifications.length - 1].createdAt;
    await setLastDigestedAt(userId, taskId, newest);
    await clearDigestWindow(userId, taskId);

    return res.status(200).json({ ok: true, sent: true, events: events.length });
  } catch (error) {
    console.log("🤔 ~ notificationDigestQueue ~ error:", error);
    // 500 so QStash retries. Nothing has been sent on this path: sendEmail is
    // the last statement that can throw, and it throws only on a non-OK
    // response. The watermark makes a retry that follows a delivered-but-
    // unacknowledged send a no-op rather than a duplicate.
    return res.status(500).json({ ok: false });
  }
}

/**
 * Sends the single email this digest window replaced. Used only when the window
 * produced no Notification rows at all, which means the insert failed rather
 * than the recipient having read anything.
 */
async function sendFallback(userId: number, taskId: number): Promise<boolean> {
  const fallback = await getDigestFallback(userId, taskId);
  if (!fallback) return false;

  const body = fallback.body as unknown as INotificationBody;
  if (!body?.recipient) return false;

  console.log(
    "🤔 ~ notificationDigestQueue ~ no notification row, sending the original email instead:",
    { userId, taskId, type: fallback.type }
  );

  // A claim written before "Follower" was split into "Mention" + "Follower"
  // used "Follower" for both, and only the mention path ever carried a comment.
  // Without this, a job spanning the deploy would mail "added you to" for what
  // was really a mention.
  const type =
    fallback.type === "Follower" && body.commentText
      ? "Mention"
      : (fallback.type as TNotification);

  const { subject, html } = renderNotificationEmail(type, body);

  await sendEmail({
    to: body.recipient,
    from: `${body.sender} <notifications@hypertask.ai>`.trim(),
    replyTo: createNotificationReplyAddress(taskId, userId),
    subject,
    html,
    headers: unsubscribeHeaders(userId, body.recipient),
  });

  return true;
}

export default withQstashSignature(handler);

export const config = {
  api: {
    bodyParser: false,
  },
};
