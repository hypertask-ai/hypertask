import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { NextRequest, NextResponse } from "next/server";

export function parseTaskId(value: unknown) {
  const taskId = Number(value);
  return Number.isInteger(taskId) && taskId > 0 ? taskId : null;
}

export async function getTimeRequestUser(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session) {
    return {
      userId: null,
      response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { userId: session.userId, response: null };
}

export async function validateTimeTaskAccess(userId: number, taskId: number) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      status: { not: "Deleted" },
      project: {
        ...getProjectWhere(userId),
        status: { in: ["Normal", "Archive"] },
      },
    },
    select: { id: true },
  });
  return task
    ? null
    : NextResponse.json(
        { success: false, error: "Task not found or access denied" },
        { status: 404 }
      );
}
