import prisma from "@/lib/prisma";
import invokeReminder from "@/utils/controllers/reminders/invokeReminder";
import { getUserPreferenceFromUserId } from "../get-userSettings-preference";
import { broadcastInboxChange } from "@/lib/realtime/server";
import type { Prisma } from "@prisma/client";
import { withTaskInboxWriteLock } from "@/lib/taskCardActions/writeLocks";
import { isProjectMuted } from "../projectMute";

type NotificationDatabase = Prisma.TransactionClient | typeof prisma;
type CreatedNotification = Prisma.NotificationGetPayload<{
  include: {
    fromUser: true;
    fromAgent: true;
    user: { include: { UserSetting: true } };
  };
}>;

const checkReminderAndCreateNotification = async (
  userId: number,
  projectId: number,
  taskId: number,
  payload: any,
  now: boolean = false,
  database: NotificationDatabase = prisma,
): Promise<CreatedNotification | undefined> => {
  if (database === prisma) {
    const notification = await withTaskInboxWriteLock(taskId, (tx) =>
      checkReminderAndCreateNotification(
        userId,
        projectId,
        taskId,
        payload,
        now,
        tx,
      ),
    );
    if (notification) {
      void broadcastInboxChange(userId, { originUserId: payload.fromUserId });
    }
    return notification;
  }

  console.log("🚀 ~ checkReminderAndCreateNotification: payload:", payload);

    // Always check user preference first, regardless of reminder status
    // const notificationType = payload.type || "Comment";
    // const shouldCreate = await getUserPreferenceFromUserId(userId, notificationType);
    
    // if (!shouldCreate) {
    //   console.log(
    //     "🚀 ~ checkReminderAndCreateNotification: Notification blocked by user preference"
    //   );
    //   return undefined;
    // }

    // Board mutes apply only to the human inbox. Agent-addressed events must
    // still reach the managed agent even though its token belongs to a user.
    if (!payload?.agentId && await isProjectMuted(userId, projectId, database)) {
      return undefined;
    }

    // A reminder is a user-level snooze: it archives the notification and
    // re-delivers it when the reminder fires. Agents do not snooze, and their
    // rows live in a separate agent inbox, so an owner's active reminder must
    // not archive a notification addressed to their agent (HTPR-4094).
    const reminderFound = payload?.agentId
      ? null
      : await database.reminder.findFirst({
          where: {
            userId: userId,
            projectId: projectId,
            taskId: taskId,
            status: "Normal",
          },
        });

    if (reminderFound) {
      console.log(
        "🚀 ~ checkReminderAndCreateNotification: reminder was found"
      );
      if (reminderFound.invokeCondition === "DurationComplete") {
        const notification = await database.notification.create({
          data: {
            ...payload,
            status: "Archive",
          },
        });
        console.log(
          "🚀 ~ checkReminderAndCreateNotification: DurationCompleted",
          notification
        );
        if (now) {
          await (database === prisma
            ? invokeReminder(reminderFound)
            : invokeReminder(reminderFound, database));
        }
        return undefined;
      } else {
        const notification = await database.notification.create({
          data: {
            ...payload,
          },
          include: {
            fromUser: true,
            fromAgent: true,
            user: {
              include: {
                UserSetting: true,
              },
            },
          },
        });
        await (database === prisma
          ? invokeReminder(reminderFound)
          : invokeReminder(reminderFound, database));
        console.log(
          "🚀 ~ checkReminderAndCreateNotification: NewNotification",
          notification
        );
        return notification;
      }
    } else {
      console.log(
        "🚀 ~ checkReminderAndCreateNotification: reminder was not found"
      );
      const notification = await database.notification.create({
        data: {
          ...payload,
        },
        include: {
          fromUser: true,
          fromAgent: true,
          user: {
            include: {
              UserSetting: true,
            },
          },
        },
      });
      return notification;
    }
};

export default checkReminderAndCreateNotification;
