import prisma from "@/lib/prisma";
import { NotificationType } from "@prisma/client";

type NotificationChannel = "email" | "push";
type NotificationCategory =
  | "mentions"
  | "comments"
  | "assignments"
  | "moves"
  | "dueDates"
  | "invites";

const notificationCategoryByType: Record<
  NotificationType,
  NotificationCategory
> = {
  Mentioned: "mentions",
  AddedToFollowerInTask: "mentions",
  Comment: "comments",
  Reacted: "comments",
  Assigned: "assignments",
  TaskMoved: "moves",
  TaskArchived: "moves",
  TaskMovedToInbox: "moves",
  TaskUpdateDescription: "moves",
  TaskDueDate: "dueDates",
  TaskOverdue: "dueDates",
  TaskReminder: "dueDates",
  Invited: "invites",
  AgentMessage: "comments",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface NotificationSettingRow {
  notification: boolean;
  notificationMatrix: unknown;
  notificationPreference: string | null;
}

export function resolveNotificationChannelPreference(
  userSetting: NotificationSettingRow,
  type: NotificationType,
  channel: NotificationChannel
): boolean {
  if (channel === "email" && !userSetting.notification) return false;

  const category = notificationCategoryByType[type];
  const matrix = userSetting.notificationMatrix;

  if (isRecord(matrix)) {
    const categorySetting = matrix[category];
    if (
      isRecord(categorySetting) &&
      typeof categorySetting[channel] === "boolean"
    ) {
      return categorySetting[channel];
    }
  }

  const preference = userSetting.notificationPreference;
  if (preference === "all") return true;
  if (preference === "nothing") return false;

  return type === "Mentioned" || type === "Assigned";
}

export async function shouldNotify(
  userId: number,
  type: NotificationType,
  channel: NotificationChannel
): Promise<boolean> {
  const userSetting = await prisma.userSetting.findUnique({
    where: { userId },
    select: {
      notification: true,
      notificationMatrix: true,
      notificationPreference: true,
    },
  });

  if (!userSetting) return false;
  return resolveNotificationChannelPreference(userSetting, type, channel);
}
