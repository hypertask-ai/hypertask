import type { Prisma, PrismaClient } from "@prisma/client";

import prisma from "@/lib/prisma";

type NotificationDatabase = Pick<
  PrismaClient | Prisma.TransactionClient,
  "notification"
>;

export function notificationStore(database: NotificationDatabase = prisma) {
  return database.notification;
}

export function markInboxNotificationsSeen(userId: number, notificationIds: number[]) {
  return notificationStore().updateMany({
    where: { id: { in: notificationIds }, userId, seen: false },
    data: { seen: true },
  });
}

export function unarchiveInboxNotifications(
  userId: number,
  notificationIds: number[],
) {
  return notificationStore().updateMany({
    where: { id: { in: notificationIds }, userId, status: "Archive" },
    data: { status: "Normal", archivedAt: null },
  });
}
