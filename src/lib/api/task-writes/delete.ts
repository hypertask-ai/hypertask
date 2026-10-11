import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "./route";
import { permanentlyDeleteTask } from "@/utils/controllers/tasks/invokeTaskDelete";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const route = taskWriteRoute({
  schema: z.custom<{ parsedTaskId: number }>((body) => Number.isInteger((body as any)?.parsedTaskId) && (body as any).parsedTaskId >= 0),
  validationMessage: "Missing required information",
  operation: async ({ parsedTaskId }, session) => {
    // Capture the board before the row is gone so we can refresh it for everyone.
    const deletedTask = await prisma.task.findFirst({
      where: {
        id: parsedTaskId,
        status: "Deleted",
        project: taskWriteAccessWhere(session.userId),
      },
      select: { projectId: true },
    });
    if (!deletedTask)
      return NextResponse.json({ message: "Task not found or access denied" }, { status: 404 });
    const invokeDelete = await permanentlyDeleteTask(
      parsedTaskId,
      session.userId,
    );

    if (invokeDelete === "success") {
      void broadcastBoardChange(deletedTask?.projectId);
      return NextResponse.json({ message: "Success" }, { status: 200 });
    }
    return NextResponse.json({ message: "Task is being restored or permanently deleted" }, { status: 409 });
  },
});

export const DELETE: TaskWriteRoute = async (request, session) => {
  try {
    const values = request.query ? request.query.taskId : new URL(request.url!).searchParams.getAll("taskId");
    const taskId = request.query ? values : (values?.length === 1 ? values[0] : values?.length ? values : undefined);
    const parsedTaskId = Number(taskId);
    if (!Number.isInteger(parsedTaskId) || parsedTaskId < 0) {
      return NextResponse.json({ message: "Missing required information" }, { status: 400 });
    }
    session ??= (await getSessionUser(request.headers)) ?? undefined;
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    return await route({ headers: request.headers, json: async () => ({ parsedTaskId }) }, session);
  } catch (error) {
    console.log(error);
    return NextResponse.json(error, { status: 500 });
  }
};
