import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { notificationWriteJson } from "./response";
import notificationGetAll from "@/utils/controllers/notifications/getAll";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const getRoute = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (_body, session) => {
    const response = await notificationGetAll(String(session.userId))
    return notificationWriteJson(response.json, response.status);
  },
});

export const GET: TaskWriteRoute = async (request, authenticatedSession) => {
  const requestStartedAt = performance.now();
  try {
    const session = authenticatedSession ?? await getSessionUser(request.headers);
    if (!session) return notificationWriteJson({ message: "Unauthorized" }, 401);
    const body = undefined;
    const response = await getRoute({ ...request, headers: request.headers, json: async () => body }, session);
    response!.headers.set("Server-Timing", `total;dur=${(performance.now() - requestStartedAt).toFixed(1)}`);
    return response;
  } catch (error) {
    console.error(error);
    return notificationWriteJson({ message: "Internal server error" }, 500);
  }
};
