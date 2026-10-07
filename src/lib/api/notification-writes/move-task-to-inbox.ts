import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { ensureTaskMovedToInbox } from "@/lib/taskCardActions/inboxState";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session) => {
    // HTPR-4772: ignore the body userId and use the signed session.

    const { taskId, projectId } = body;
    const userId = session.userId;
    if (!taskId || !projectId)
      return NextResponse.json({ message: "Missing required data" }, { status: 400 });
    const payload = {
      taskId,
      userId,
      projectId,
      type: "TaskMovedToInbox",
      fromUserId: userId,
    };

    await ensureTaskMovedToInbox(
      { userId, projectId, taskId },
      payload,
    );
    return NextResponse.json({ message: "Success" }, { status: 200 });
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
