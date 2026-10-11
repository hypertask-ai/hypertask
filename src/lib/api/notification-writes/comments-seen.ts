import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import notificationGetByTask from "@/utils/controllers/notifications/getByTask";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session) => {
    const { commentIds, taskId } = body;
    const userId = session.userId;

    if (!commentIds) {
      return NextResponse.json({ message: "Comment ids are required" }, { status: 400 });
    }

    const task = await prisma.task.findFirst({
      where: { id: Number(taskId), project: projectContentAccessWhere(userId) },
      select: { id: true },
    });
    if (!task) return NextResponse.json({ message: "Task not found" }, { status: 404 });

    await notificationGetByTask(userId, taskId);

    // One UPDATE for the whole task, and only for comments this user has
    // not seen yet — the previous per-comment update fan-out starved the
    // Prisma pool (limit 5) on tasks with many comments. See HTPR-4033.
    await prisma.comment.updateMany({
      where: {
        id: { in: commentIds },
        taskId: task.id,
        NOT: { seen: { has: userId } },
      },
      data: {
        seen: { push: userId },
      },
    });

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
