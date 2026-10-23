import { z } from "zod";
import { legacyTaskWriteSession, taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { viewWriteJson } from "./response";
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
  const session = await legacyTaskWriteSession(request);
  if (!session) return viewWriteJson({ message: "Unauthorized" }, 401);
  return route(request, session);
};
