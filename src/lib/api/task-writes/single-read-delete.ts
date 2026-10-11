import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "./route";
import { deleteTaskSingle, getTaskSingle } from "@/utils/controllers/tasks/single";
import prisma from "@/lib/prisma";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

const userCanAccessProject = async (userId: number, projectId: number) => {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ...taskWriteAccessWhere(userId),
    },
    select: { id: true },
  });
  return !!project;
};

const singleReadRoute = taskWriteRoute({
  schema: z.custom<{ id?: string | string[] }>(() => true),
  validationMessage: "Task id is required",
  operation: async ({ id }, session) => {
    if (!session.userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (!id) {
      return NextResponse.json({ message: "Task id is required" }, { status: 400 });
    }
    const response = await getTaskSingle(parseInt(id as string));
    const task = response.json as { projectId?: number } | null;
    if (
      response.status === 200 &&
      task?.projectId &&
      !(await userCanAccessProject(session.userId, task.projectId))
    ) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(response.json, { status: response.status });
  },
});

export const GET: TaskWriteRoute = async (request, session) => {
  try {
    return await singleReadRoute({
      headers: request.headers,
      json: async () => {
        if (request.query) return request.query;
        const ids = new URL(request.url!).searchParams.getAll("id");
        return { id: ids.length === 1 ? ids[0] : ids.length ? ids : undefined };
      },
    }, session);
  } catch (error) {
    console.log({ error });
    return NextResponse.json({ message: "Internal server error" + JSON.stringify(error) }, { status: 500 });
  }
};

const singleDeleteRoute = taskWriteRoute({
  schema: z.custom<{ id: string | string[] }>(() => true),
  validationMessage: "Missing ID",
  operation: async ({ id }, session) => {
    const taskToDelete = await prisma.task.findUnique({
      where: { id: parseInt(id as string) },
      select: { projectId: true },
    });
    if (
      taskToDelete &&
      !(await userCanAccessProject(session.userId, taskToDelete.projectId))
    ) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }
    const response = await deleteTaskSingle(parseInt(id as string), session.userId);
    return NextResponse.json(response.json, { status: response.status });
  },
});

export const DELETE: TaskWriteRoute = async (request, session) => {
  try {
    const ids = request.query ? undefined : new URL(request.url!).searchParams.getAll("id");
    const id = request.query ? request.query.id : ids?.length === 1 ? ids[0] : ids?.length ? ids : undefined;
    // DELETE historically validates the query before resolving authentication.
    if (!id) return NextResponse.json({ message: "Missing ID" }, { status: 400 });
    return await singleDeleteRoute({ headers: request.headers, json: async () => ({ id }) }, session);
  } catch (error) {
    console.log(error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
};
