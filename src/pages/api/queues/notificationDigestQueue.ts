import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { canReadTaskNow } from "@/lib/access/canReadTaskNow";
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
    if (!(await canReadTaskNow(userId, taskId))) {
      await clearDigestWindow(userId, taskId);
      return res
        .status(200)
        .json({ ok: true, sent: false, reason: "access revoked" });
    }

    if (await isTaskProjectMuted(userId, taskId)) {
      await clearDigestWindow(userId, taskId);
      return res
        .status(200)
        .json({ ok: true, sent: false, reason: "board muted" });
    }

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

    const setting = recipient.UserSetting;
    const allowed = notifications.filter((notification) =>
      resolveNotificationChannelPreference(setting, notification.type, "email")
    );

    const events: IDigestEvent[] = dedupePerComment(allowed).map(
      (notification) => {
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
      headers: unsubscribeHeaders(userId, recipient.email),
    });

    const newest = notifications[notifications.length - 1].createdAt;
    await setLastDigestedAt(userId, taskId, newest);
    await clearDigestWindow(userId, taskId);

    return res.status(200).json({ ok: true, sent: true, events: events.length });
  } catch (error) {
    console.log("🤔 ~ notificationDigestQueue ~ error:", error);
    return res.status(500).json({ ok: false });
  }
}

async function sendFallback(userId: number, taskId: number): Promise<boolean> {
  const fallback = await getDigestFallback(userId, taskId);
  if (!fallback) return false;

  const body = fallback.body as unknown as INotificationBody;
  if (!body?.recipient) return false;

  console.log(
    "🤔 ~ notificationDigestQueue ~ no notification row, sending the original email instead:",
    { userId, taskId, type: fallback.type }
  );

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
