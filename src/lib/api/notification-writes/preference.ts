import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { notificationWriteJson } from "./response";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";

type NotificationLevel = "all" | "direct" | "nothing";

const postRoute = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session) => {
    const userId = session.userId;
    const { notificationLevel } = body as { notificationLevel?: NotificationLevel };

    if (!notificationLevel || !["all", "direct", "nothing"].includes(notificationLevel)) {
      return notificationWriteJson({ message: "Invalid notification level" }, 400);
    }

    const updated = await prisma.userSetting.update({
      where: { userId },
      data: {
        notificationPreference: notificationLevel,
      },
      select: {
        notificationPreference: true,
      },
    });

    return notificationWriteJson({ notificationPreference: updated.notificationPreference }, 200);
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
