import prisma from "@/lib/prisma";
import invokeReminder from "@/utils/controllers/reminders/invokeReminder";
import { getUserPreferenceFromUserId } from "../get-userSettings-preference";
import { broadcastInboxChange } from "@/lib/realtime/server";
import type { Prisma } from "@prisma/client";
import { withTaskInboxWriteLock } from "@/lib/taskCardActions/writeLocks";
import { filterProjectMutedUserIds, isProjectMuted } from "../projectMute";

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

    if (!payload?.agentId && await isProjectMuted(userId, projectId, database)) {
      return undefined;
    }

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

type BatchNotificationPayload = Omit<
  Prisma.NotificationCreateManyInput,
  "userId" | "agentId" | "fromUserId"
> & { fromUserId: number };

export const NOTIFICATION_LOCK_CHUNK_SIZE = 10;

export const checkRemindersAndCreateNotifications = async (
  userIds: number[],
  projectId: number,
  taskId: number,
  payload: BatchNotificationPayload,
): Promise<void> => {
  for (
    let start = 0;
    start < userIds.length;
    start += NOTIFICATION_LOCK_CHUNK_SIZE
  ) {
    await createNotificationChunk(
      userIds.slice(start, start + NOTIFICATION_LOCK_CHUNK_SIZE),
      projectId,
      taskId,
      payload,
    );
  }
};

const createNotificationChunk = async (
  userIds: number[],
  projectId: number,
  taskId: number,
  payload: BatchNotificationPayload,
): Promise<void> => {
  const deliveredUserIds = await withTaskInboxWriteLock(taskId, async (tx) => {
    const unmutedUserIds = await filterProjectMutedUserIds(
      userIds,
      projectId,
      tx,
    );
    if (unmutedUserIds.length === 0) return [];

    const reminders = await tx.reminder.findMany({
      where: {
        userId: { in: unmutedUserIds },
        projectId,
        taskId,
        status: "Normal",
      },
    });
    const reminderByUserId = new Map<number, (typeof reminders)[number]>();
    for (const reminder of reminders) {
      if (!reminderByUserId.has(reminder.userId)) {
        reminderByUserId.set(reminder.userId, reminder);
      }
    }
    const isSnoozed = (userId: number) =>
      reminderByUserId.get(userId)?.invokeCondition === "DurationComplete";

    await tx.notification.createMany({
      data: unmutedUserIds.map((userId) => ({
        ...payload,
        userId,
        ...(isSnoozed(userId) ? { status: "Archive" as const } : {}),
      })),
    });

    const delivered: number[] = [];
    for (const userId of unmutedUserIds) {
      if (isSnoozed(userId)) continue;
      const reminder = reminderByUserId.get(userId);
      if (reminder) await invokeReminder(reminder, tx);
      delivered.push(userId);
    }
    return delivered;
  });

  for (const userId of deliveredUserIds) {
    void broadcastInboxChange(userId, { originUserId: payload.fromUserId });
  }
};

export default checkReminderAndCreateNotification;
