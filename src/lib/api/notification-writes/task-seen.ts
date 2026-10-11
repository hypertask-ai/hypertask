import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import notificationGetByTask from "@/utils/controllers/notifications/getByTask";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session) => {
    const { taskId } = body;
    if (!taskId) {
      return NextResponse.json({ message: "Task id is required" }, { status: 400 });
    }

    const response = await notificationGetByTask(session.userId, taskId);
    return NextResponse.json(response.json, { status: response.status });
  },
});

export const POST: TaskWriteRoute = async (request, authenticatedSession) => {
  try {
    const session = authenticatedSession ?? await getSessionUser(request.headers);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    return await route({ ...request, headers: request.headers, json: async () => body }, session);
  } catch (error) {
    console.log(error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
};
