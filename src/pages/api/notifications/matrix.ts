import type { NextApiRequest, NextApiResponse } from "next";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import {
  getShowImportantSplit,
  getSplitsNoImportant,
  withSplitsNoImportant,
} from "@/lib/inboxSplitSettings";

// Invites are transactional and deliberately not configurable: nothing routes
// them through shouldNotify, so accepting an "invites" key would store a
// setting that never takes effect.
const notificationCategories = [
  "mentions",
  "comments",
  "assignments",
  "moves",
  "dueDates",
] as const;

type NotificationCategory = (typeof notificationCategories)[number];
type NotificationMatrix = Partial<
  Record<NotificationCategory, { email: boolean; push: boolean }>
>;

const categorySet = new Set<string>(notificationCategories);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNotificationMatrix = (value: unknown): value is NotificationMatrix => {
  if (!isRecord(value)) return false;

  return Object.entries(value).every(([category, settings]) => {
    if (!categorySet.has(category) || !isRecord(settings)) return false;

    const keys = Object.keys(settings);
    return (
      keys.length === 2 &&
      keys.every((key) => key === "email" || key === "push") &&
      typeof settings.email === "boolean" &&
      typeof settings.push === "boolean"
    );
  });
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) return res.status(401).json({ message: "Unauthorized" });

    if (req.method === "GET") {
      const userSetting = await prisma.userSetting.findUnique({
        where: { userId: session.userId },
        select: {
          notificationMatrix: true,
          notificationPreference: true,
        },
      });

      return res.status(200).json({
        matrix: userSetting?.notificationMatrix ?? {},
        notificationPreference: userSetting?.notificationPreference ?? "all",
      });
    }

    const matrix = req.body?.matrix;
    if (!isNotificationMatrix(matrix)) {
      return res.status(400).json({ message: "Invalid notification matrix" });
    }

    const current = await prisma.userSetting.findUnique({
      where: { userId: session.userId },
      select: { notificationMatrix: true },
    });
    if (!current) {
      return res.status(404).json({ message: "User settings not found" });
    }

    const updated = await prisma.userSetting.update({
      where: { userId: session.userId },
      data: {
        notificationMatrix: {
          ...withSplitsNoImportant(
            matrix,
            getSplitsNoImportant(current.notificationMatrix)
          ),
          ...(getShowImportantSplit(current.notificationMatrix)
            ? { showImportantSplit: true }
            : {}),
        } as Prisma.InputJsonObject,
      },
      select: { notificationMatrix: true },
    });

    return res.status(200).json({ matrix: updated.notificationMatrix });
  } catch (error) {
    console.error("Error updating notification matrix", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default handler;
