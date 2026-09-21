// pages/api/setupReminder.js
// id:`notifications-for-task-${taskId}`

import {
  cancelInboxReminderJob,
  cancelInboxReminderRevisionJob,
  cancelLegacyInboxReminderJobIfSafe,
  scheduleInboxReminderJob,
} from "./inboxQueue";
import { subMinutes } from "date-fns"


import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import checkReminderAndCreateNotification from "@/utils/controllers/notifications/creation-service/check-reminder_create-notification";
import { nextReminderRevision } from "@/utils/controllers/reminders/revision";
import { userCanAccessTask } from "@/utils/controllers/tasks/assertTaskAccess";
import { syncMyTasksSnoozeFromReminder } from "@/utils/controllers/tasks/myTasksSnooze";
import { isFeatureEnabled, MY_TASKS_SNOOZE_FLAG } from "@/lib/flags";

const REMINDER_LOCK_CLASS = 1_446_420_610

export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  console.log("🚀 ~ inboxReminder", req.body)
  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>)
  );
  if (!session) return res.status(401).json({ message: "Unauthorized" });

  const {taskId, userId: bodyUserId, projectId, remindAt, reminderOption, remindTask } = req.body;
  if (!taskId || !projectId || !remindAt) return res.status(400).json({message:"Missing Required Information"})
  if (bodyUserId != null && Number(bodyUserId) !== session.userId) {
    return res.status(403).json({ message: "Forbidden" });
  }
  const userId = session.userId;
  if (!(await userCanAccessTask(userId, Number(taskId)))) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const remindAtDate = new Date(remindAt);
  const defaultInvoke = reminderOption ?? "DurationComplete"
  try {
      const hideOnMyTasks = await isFeatureEnabled(MY_TASKS_SNOOZE_FLAG, userId)
      const reminder = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REMINDER_LOCK_CLASS}::int, ${Number(taskId)}::int)`
        const existing = await tx.reminder.findMany({
          where: { userId, taskId },
          orderBy: { id: "asc" },
        })
        const writeRevision = nextReminderRevision(existing)
        const active = existing.filter((item) => item.status === "Normal")
        if (active.length > 1) {
          await tx.reminder.updateMany({
            where: { id: { in: active.slice(1).map((item) => item.id) } },
            data: { status: "Archive", updatedAt: writeRevision },
          })
        }
        const previous = active[0] ?? null
        const saved = previous
          ? await tx.reminder.update({
              where: { id: previous.id },
              data: {
                projectId,
                remindAt: remindAtDate,
                updatedAt: writeRevision,
                invokeCondition: defaultInvoke,
              },
            })
          : await tx.reminder.create({
              data: {
                userId,
                taskId,
                remindAt: remindAtDate,
                projectId,
                updatedAt: writeRevision,
                invokeCondition: defaultInvoke,
              },
            })
        await tx.notification.updateMany({
          where: { userId, taskId, status: "Normal" },
          data: { status: "Archive", archivedAt: new Date() },
        })
        if (hideOnMyTasks) {
          await syncMyTasksSnoozeFromReminder({
            userId,
            taskId,
            snoozeUntil: remindAtDate,
            client: tx,
          })
        }
        return { reminder: saved, previous }
      })

      if(remindTask === false){
        //Create a notification reminder for the Task
        await checkReminderAndCreateNotification(
          userId,
          projectId,
          taskId,
          {
            userId:userId,
            taskId:taskId,
            projectId: projectId,
            type:"TaskReminder",
            status:"Archive",
            fromUserId: userId,
          }
        );
      }


      await cancelInboxReminderJob(userId, taskId)
      await cancelInboxReminderRevisionJob(reminder.previous)
      await cancelLegacyInboxReminderJobIfSafe(userId, taskId)
      await scheduleInboxReminderJob(reminder.reminder, subMinutes(remindAtDate, 0))
      return res.status(200).json(reminder.reminder)
  } catch (error) {
    return res.status(500).json(error)
  }
 
};
