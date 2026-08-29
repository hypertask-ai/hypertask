import prisma from "@/lib/prisma";

export const markTaskRead = async (taskId: number, userId: number) => {
  if (!Number.isFinite(taskId) || !Number.isFinite(userId)) {
    return { status: 400, json: { message: "Task id is required" } };
  }

  try {
    const readState = await prisma.taskReadState.upsert({
      where: {
        taskId_userId: {
          taskId,
          userId,
        },
      },
      create: {
        taskId,
        userId,
        lastReadAt: new Date(),
      },
      update: {
        lastReadAt: new Date(),
      },
      select: {
        lastReadAt: true,
      },
    });

    return { status: 200, json: readState };
  } catch (error) {
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
