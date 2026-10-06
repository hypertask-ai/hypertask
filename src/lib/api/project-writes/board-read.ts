import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import getBoardTasks from "@/utils/controllers/projects/getBoardTasks";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  operation: async (body, session) => {
    const req = { body };
    const response = await getBoardTasks(req.body.projectId, session.userId, session.userId);
    return NextResponse.json(response.json, { status: response.status });
  },
});

export const POST: TaskWriteRoute = async (request, authenticatedSession) => {
  const session = authenticatedSession ?? await getSessionUser(request.headers);
  if (!session) return NextResponse.json({ error: "Unauthorized", code: "SESSION_REQUIRED" }, { status: 401 });
  return route(request, session);
};
