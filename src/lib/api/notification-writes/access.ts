import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { notificationWriteJson } from "./response";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { getInboxAccessibleProjectIds } from "@/utils/controllers/notifications/getAccessibleProjectIds";

const getRoute = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (_body, session) => {
    const projectIds = await getInboxAccessibleProjectIds(session.userId);

    return notificationWriteJson({ accountId: session.userId, projectIds }, 200);
  },
});

export const GET: TaskWriteRoute = async (request, authenticatedSession) => {
  try {
    const session = authenticatedSession ?? await getSessionUser(request.headers);
    if (!session) return notificationWriteJson({ message: "Unauthorized" }, 401);
    const body = undefined;
    const response = await getRoute({ ...request, headers: request.headers, json: async () => body }, session);
    response!.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } catch (error) {
    console.error(error);
    return notificationWriteJson({ message: "Internal server error" }, 500);
  }
};
