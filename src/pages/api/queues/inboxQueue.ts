import type { NextApiRequest, NextApiResponse } from "next";
import { cancelJobById, scheduleJobById } from "@/lib/qstash";
import { withQstashSignature } from "@/lib/qstash";
import { invokeDueReminder } from "@/utils/controllers/reminders/invokeReminder";
import type { IReminder } from "@/models/model";
import prisma from "@/lib/prisma";

export const INBOX_QUEUE_PATH = "/api/queues/inboxQueue";

function reminderRevision(reminder: IReminder) {
  const value = reminder.updatedAt ?? reminder.remindAt;
  const timestamp = new Date(value as Date | string).getTime();
  return Number.isFinite(timestamp) ? timestamp : reminder.id;
}

export function buildInboxReminderJobId(reminder: IReminder) {
  return `notifications-for-user-${reminder.userId}-task-${reminder.taskId}-revision-${reminderRevision(reminder)}`;
}

export async function scheduleInboxReminderJob(reminder: IReminder, runAt: Date) {
  return scheduleJobById({
    jobId: buildInboxReminderJobId(reminder),
    path: INBOX_QUEUE_PATH,
    body: reminder,
    notBefore: Math.floor(runAt.getTime() / 1000),
  });
}

export async function cancelInboxReminderJob(userId: number, taskId: number) {
  // Cancel only the pre-revision per-user ID. Revisioned jobs are immutable;
  // stale and legacy task-only jobs are harmless because invokeDueReminder
  // atomically claims the current active, due database row before delivery.
  return cancelJobById(`notifications-for-user-${userId}-task-${taskId}`, INBOX_QUEUE_PATH);
}

export async function cancelInboxReminderRevisionJob(reminder: IReminder | null | undefined) {
  if (!reminder) return false;
  await cancelJobById(buildInboxReminderJobId(reminder), INBOX_QUEUE_PATH);
  return true;
}

export async function cancelLegacyInboxReminderJobIfSafe(userId: number, taskId: number) {
  const otherActiveOwners = await prisma.reminder.count({
    where: { taskId, status: "Normal", userId: { not: userId } },
  });
  if (otherActiveOwners > 0) return false;
  await cancelJobById(`notifications-for-task-${taskId}`, INBOX_QUEUE_PATH);
  return true;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
    const job = req.body as any;
    console.log("🚀 ~ job:", job)
    // ================== job execution time *-*, you finally recieve the notification

    try {
      const result = await invokeDueReminder(job)
      return res.status(200).json({ ok: true, result });

    } catch (error) {
       console.log("🚀 ~ error:", error)
       return res.status(500).json({ ok: false });
      
    }
}

export default withQstashSignature(handler);

export const config = {
  api: {
    bodyParser: false,
  },
};
