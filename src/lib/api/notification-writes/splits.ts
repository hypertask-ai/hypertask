import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { notificationWriteJson } from "./response";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import {
  getSplitsNoImportant,
  isInboxSplitKey,
} from "@/lib/inboxSplitSettings";

const getRoute = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (_body, session) => {
    const userSetting = await prisma.userSetting.findUnique({
      where: { userId: session.userId },
      select: { notificationMatrix: true },
    });
    if (!userSetting) {
      return notificationWriteJson({ message: "User settings not found" }, 404);
    }
    return notificationWriteJson({
      splitsNoImportant: getSplitsNoImportant(
        userSetting.notificationMatrix
      ),
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
    const splitsNoImportant = body?.splitsNoImportant;
    if (
      !Array.isArray(splitsNoImportant) ||
      splitsNoImportant.length > 200 ||
      !splitsNoImportant.every(isInboxSplitKey)
    ) {
      return notificationWriteJson({ message: "Invalid inbox split settings" }, 400);
    }

    const uniqueSplits = Array.from(new Set(splitsNoImportant));
    const updatedRows = await prisma.$executeRaw`
      UPDATE "UserSetting"
      SET "notificationMatrix" = jsonb_set(
        COALESCE("notificationMatrix", '{}'::jsonb),
        '{splitsNoImportant}',
        ${JSON.stringify(uniqueSplits)}::jsonb
      )
      WHERE "userId" = ${session.userId}
    `;
    if (updatedRows === 0) {
      return notificationWriteJson({ message: "User settings not found" }, 404);
    }

    return notificationWriteJson({
      splitsNoImportant: uniqueSplits,
    }, 200);
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
