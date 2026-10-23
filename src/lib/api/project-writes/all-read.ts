import { NextResponse } from "next/server";
import { z } from "zod";
import { legacyTaskWriteSession, taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import getAllProjectsController from "@/utils/controllers/projects/getAll";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  operation: async (body, session) => {
    const req = { body };
    const response = await getAllProjectsController(session.userId, session.userId, req.body?.projectId);
    return NextResponse.json(response.json, { status: response.status });
  },
});

export const POST: TaskWriteRoute = async (request) => {
  const session = await legacyTaskWriteSession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized", code: "SESSION_REQUIRED" }, { status: 401 });
  return route(request, session);
};
