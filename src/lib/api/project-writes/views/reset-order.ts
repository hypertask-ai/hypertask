import { z } from "zod";
import { legacyTaskWriteSession, taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { viewWriteJson } from "./response";
import {
  resetUserViewOrder,
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
      await resetUserViewOrder(projectId, session.userId);
      return viewWriteJson({ viewOrder: null }, 200);
    } catch (error) {
      if (error instanceof ViewOrderError) {
        return viewWriteJson({ message: error.message }, error.status);
      }
      console.error("reset view order failed", error);
      return viewWriteJson({ message: "Unable to reset view order" }, 500);
    }

  },
});

export const POST: TaskWriteRoute = async (request) => {
  const session = await legacyTaskWriteSession(request);
  if (!session) return viewWriteJson({ message: "Unauthorized" }, 401);
  return route(request, session);
};
