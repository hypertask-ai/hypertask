import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { NextRequest, NextResponse } from "next/server";
import { getTimeRequestUser, parseTaskId } from "../_lib";

export async function GET(request: NextRequest) {
  const auth = await getTimeRequestUser(request);
  if (auth.response) return auth.response;

  const boardId = parseTaskId(request.nextUrl.searchParams.get("board"));
  if (!boardId) {
    return NextResponse.json(
      { success: false, error: "board must be a positive integer" },
      { status: 400 }
    );
  }

  const q = request.nextUrl.searchParams.get("q")?.trim();
  const taskId = parseTaskId(request.nextUrl.searchParams.get("task"));
  const tasks = await prisma.task.findMany({
    where: {
      projectId: boardId,
      ...(taskId ? { id: taskId } : {}),
      status: { in: ["Normal", "Archive"] },
      project: {
        ...getProjectWhere(auth.userId),
        status: "Normal",
        timeTrackingEnabled: true,
      },
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { ticketNumber: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      uniqueIndex: true,
      ticketNumber: true,
      title: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  return NextResponse.json({ success: true, tasks });
}
