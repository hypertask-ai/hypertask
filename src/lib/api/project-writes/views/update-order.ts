import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { viewWriteJson } from "./response";
import { parseCookies } from "better-auth/cookies";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import {
  parseViewOrder,
  saveUserViewOrder,
  ViewOrderError,
} from "@/utils/controllers/projects/views/viewOrder";


const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  operation: async (body, session) => {
    const req = { body };
    try {
      const projectId = Number(req.body.projectId);
      if (!Number.isInteger(projectId) || projectId <= 0) {
        return viewWriteJson({ message: "Invalid projectId" }, 400);
      }
      const viewOrder = await saveUserViewOrder(
        projectId,
        session.userId,
        parseViewOrder(req.body.viewOrder)
      );
      return viewWriteJson({ viewOrder }, 200);
    } catch (error) {
      if (error instanceof ViewOrderError) {
        return viewWriteJson({ message: error.message }, error.status);
      }
      console.error("update view order failed", error);
      return viewWriteJson({ message: "Unable to update view order" }, 500);
    }

  },
});

export const POST: TaskWriteRoute = async (request) => {
  // Better Auth preflight must not broaden these signed-cookie-only routes.
  const session = verifySession(request.cookies ? request.cookies[SESSION_COOKIE] : parseCookies(request.headers.get("cookie") ?? "").get(SESSION_COOKIE));
  if (!session) return viewWriteJson({ message: "Unauthorized" }, 401);
  return route(request, { userId: session.id, source: "legacy", needsBridge: true });
};
