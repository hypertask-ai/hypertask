import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { waitUntil } from "@vercel/functions";

const isPrismaError = (error: unknown, ...codes: string[]) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  codes.includes(error.code);

const isMissingTask = (taskId: number) =>
  prisma.task
    .findUnique({ where: { id: taskId }, select: { id: true } })
    .then((task) => !task)
    .catch(() => false);

const requestSummaryRefreshOnOpen = (taskId: number) => {
  const refresh = import("@/app/api/ai/_lib/taskSummaryFreshness")
    .then(({ requestTaskSummaryRefreshOnView }) =>
      requestTaskSummaryRefreshOnView({ taskId })
    )
    .catch((error) =>
      console.warn("[task-summary] Refresh on open failed", taskId, error)
    );
  try {
    waitUntil(refresh);
  } catch {
    void refresh;
  }
};

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

  requestSummaryRefreshOnOpen(taskId);

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
