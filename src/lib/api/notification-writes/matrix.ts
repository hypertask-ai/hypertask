import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { notificationWriteJson } from "./response";
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

const getRoute = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (_body, session) => {
    const userSetting = await prisma.userSetting.findUnique({
      where: { userId: session.userId },
      select: {
        notificationMatrix: true,
        notificationPreference: true,
      },
    });

    return notificationWriteJson({
      matrix: userSetting?.notificationMatrix ?? {},
      notificationPreference: userSetting?.notificationPreference ?? "all",
    }, 200);
  },
});

export const GET: TaskWriteRoute = async (request, authenticatedSession) => {
  try {
    const session = authenticatedSession ?? await getSessionUser(request.headers);
    if (!session) return notificationWriteJson({ message: "Unauthorized" }, 401);
    const body = undefined;
    return await getRoute({ ...request, headers: request.headers, json: async () => body }, session);
  } catch (error) {
    console.error(error);
    return notificationWriteJson({ message: "Internal server error" }, 500);
  }
};

const postRoute = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session) => {
    const matrix = body?.matrix;
    if (!isNotificationMatrix(matrix)) {
      return notificationWriteJson({ message: "Invalid notification matrix" }, 400);
    }

    const current = await prisma.userSetting.findUnique({
      where: { userId: session.userId },
      select: { notificationMatrix: true },
    });
    if (!current) {
      return notificationWriteJson({ message: "User settings not found" }, 404);
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

    return notificationWriteJson({ matrix: updated.notificationMatrix }, 200);
  },
});

export const POST: TaskWriteRoute = async (request, authenticatedSession) => {
  try {
    const session = authenticatedSession ?? await getSessionUser(request.headers);
    if (!session) return notificationWriteJson({ message: "Unauthorized" }, 401);
    const body = await request.json();
    return await postRoute({ ...request, headers: request.headers, json: async () => body }, session);
  } catch (error) {
    console.error(error);
    return notificationWriteJson({ message: "Internal server error" }, 500);
  }
};
