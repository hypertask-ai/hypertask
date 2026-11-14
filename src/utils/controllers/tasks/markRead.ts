import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";
import { requestTaskSummaryRefreshOnView } from "@/app/api/ai/_lib/taskSummaryFreshness";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

const isPrismaError = (error: unknown, ...codes: string[]) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  codes.includes(error.code);

const isMissingTask = (taskId: number) =>
  prisma.task
    .findUnique({ where: { id: taskId }, select: { id: true } })
    .then((task) => !task)
    .catch(() => false);

export const markTaskRead = async (taskId: number, userId: number) => {
  if (!Number.isFinite(taskId) || !Number.isFinite(userId)) {
    return { status: 400, json: { message: "Task id is required" } };
  }

  const where = { taskId_userId: { taskId, userId } };
  const select = { lastReadAt: true };

  try {
    const readState = await prisma.taskReadState
      .upsert({
        where,
        create: { taskId, userId, lastReadAt: new Date() },
        update: { lastReadAt: new Date() },
        select,
      })
      .catch((error: unknown) => {
        if (!isPrismaError(error, "P2002")) throw error;
        return prisma.taskReadState.update({
          where,
          data: { lastReadAt: new Date() },
          select,
        });
      });

    waitUntil((async () => {
      const task = await prisma.task.findFirst({ where: { id: taskId, project: projectContentAccessWhere(userId) }, select: { userId: true } });
      if (task) await requestTaskSummaryRefreshOnView({ taskId, ownerUserId: task.userId });
    })().catch(() => undefined));
    return { status: 200, json: readState };
  } catch (error) {
    if (isPrismaError(error, "P2003", "P2025") && (await isMissingTask(taskId))) {
      return { status: 404, json: { message: "Task not found" } };
    }
    console.log(error);
    return { status: 500, json: { message: "Internal server error" } };
  }
};

export const getTaskReadStateLastReadAt = async (
  taskId: number,
  userId: number
) => {
  if (!Number.isFinite(taskId) || !Number.isFinite(userId)) return null;

  const readState = await prisma.taskReadState.findUnique({
    where: {
      taskId_userId: {
        taskId,
        userId,
      },
    },
    select: {
      lastReadAt: true,
    },
  });

  return readState?.lastReadAt ?? null;
};
