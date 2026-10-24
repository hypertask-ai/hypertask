import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getShowImportantSplit, getSplitsNoImportant, withSplitsNoImportant } from "@/lib/inboxSplitSettings";

export const notificationCategories = ["mentions", "comments", "assignments", "moves", "dueDates"] as const;
export type NotificationCategory = (typeof notificationCategories)[number];
export type NotificationMatrix = Partial<Record<NotificationCategory, { email: boolean; push: boolean }>>;

export function notificationCellValue(matrix: unknown, preference: string, category: NotificationCategory, channel: "email" | "push") {
  const stored = (matrix as NotificationMatrix | null)?.[category]?.[channel];
  if (typeof stored === "boolean") return stored;
  return category === "mentions" || category === "assignments" ? preference !== "nothing" : preference === "all";
}

type MatrixUpdate = { matrix: NotificationMatrix } | {
  category: NotificationCategory;
  channel: "email" | "push";
  value: boolean;
  expected: boolean;
};

export async function updateNotificationMatrix(userId: number, input: MatrixUpdate) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.userSetting.findUnique({
      where: { userId },
      select: { notificationMatrix: true, notificationPreference: true },
    });
    if (!current) throw new Error("User settings not found");
    let matrix: NotificationMatrix;
    if ("matrix" in input) {
      matrix = input.matrix;
    } else {
      const preference = current.notificationPreference ?? "all";
      if (notificationCellValue(current.notificationMatrix, preference, input.category, input.channel) !== input.expected) {
        throw new Error("This setting changed since the preview. Ask for a fresh proposal.");
      }
      matrix = {
        ...(current.notificationMatrix as NotificationMatrix),
        [input.category]: {
          email: notificationCellValue(current.notificationMatrix, preference, input.category, "email"),
          push: notificationCellValue(current.notificationMatrix, preference, input.category, "push"),
          [input.channel]: input.value,
        },
      };
    }
    const updated = await tx.userSetting.update({
      where: { userId },
      data: {
        notificationMatrix: {
          ...withSplitsNoImportant(matrix, getSplitsNoImportant(current.notificationMatrix)),
          ...(getShowImportantSplit(current.notificationMatrix) ? { showImportantSplit: true } : {}),
        } as Prisma.InputJsonObject,
      },
      select: { notificationMatrix: true },
    });
    return updated.notificationMatrix;
  }, { isolationLevel: "Serializable" });
}
