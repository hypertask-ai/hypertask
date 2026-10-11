import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { taskReadQuery } from "@/lib/api/task-writes/read-query";
import { notificationWriteJson } from "./response";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const parseTaskId = (value: unknown): number | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const taskId = Number(value);
  return Number.isInteger(taskId) && taskId > 0 ? taskId : null;
};

const getRoute = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session) => {
    const userId = session.userId;
    const taskId = parseTaskId(body.taskId);
    if (!taskId) {
      return notificationWriteJson({ message: "Invalid task ID" }, 400);
    }

    const taskMute = await prisma.taskMute.findUnique({
      where: { taskId_userId: { taskId, userId: userId } },
      select: { id: true },
    });

    return notificationWriteJson({ muted: Boolean(taskMute) }, 200);
  },
});

export const GET: TaskWriteRoute = async (request, authenticatedSession) => {
  const session = authenticatedSession ?? await getSessionUser(request.headers);
  if (!session) return notificationWriteJson({ message: "Unauthorized" }, 401);
  try {
    const body = taskReadQuery(request);
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
    const userId = session.userId;
    const taskId = parseTaskId(body?.taskId);
    const muted = body?.muted;
    if (!taskId || typeof muted !== "boolean") {
      return notificationWriteJson({ message: "Invalid mute preference" }, 400);
    }

    if (muted) {
      await prisma.taskMute.upsert({
        where: { taskId_userId: { taskId, userId: userId } },
        update: {},
        create: { taskId, userId: userId },
      });
    } else {
      await prisma.taskMute.deleteMany({
        where: { taskId, userId: userId },
      });
    }

    return notificationWriteJson({ muted }, 200);
  },
});

export const POST: TaskWriteRoute = async (request, authenticatedSession) => {
  const session = authenticatedSession ?? await getSessionUser(request.headers);
  if (!session) return notificationWriteJson({ message: "Unauthorized" }, 401);
  try {
    const body = await request.json();
    return await postRoute({ ...request, headers: request.headers, json: async () => body }, session);
  } catch (error) {
    console.error(error);
    return notificationWriteJson({ message: "Internal server error" }, 500);
  }
};
