import { NextResponse } from "next/server";
import type { TaskWriteRoute } from "./route";
import { taskReadQuery } from "./read-query";
import SearchForOrphanTasks from "@/utils/controllers/tasks/getOrphanTasks";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

export const GET: TaskWriteRoute = async (request, authenticatedSession) => {
  try {
    const session = authenticatedSession ?? await getSessionUser(request.headers);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const query = taskReadQuery(request);
    const { projectId, searchQuery, currentTaskId } = query;

    if (!projectId || !currentTaskId) {
      return NextResponse.json("Missing Required Data", { status: 200 });
    }

    const task = await prisma.task.findFirst({
      where: { id: parseInt(currentTaskId as string), projectId: parseInt(projectId as string), project: projectContentAccessWhere(session.userId) },
      select: { id: true },
    });
    if (!task) return NextResponse.json({ message: "Task not found" }, { status: 404 });

    const response = await SearchForOrphanTasks(
      parseInt(projectId as string),
      parseInt(currentTaskId as string),
      searchQuery as string
    );

    return NextResponse.json(response, { status: response.status });
  } catch (error) {
    console.log("🚀 ~ error:", error);
    return NextResponse.json([], { status: 200 });
  }
};
