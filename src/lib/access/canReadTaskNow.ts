import { Status } from "@prisma/client";
import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

export async function canReadTaskNow(
  userId: number,
  taskId: number
): Promise<boolean> {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      status: { not: Status.Deleted },
      project: {
        status: { not: Status.Deleted },
        ...projectContentAccessWhere(userId),
      },
    },
    select: { id: true },
  });
  return task !== null;
}

export async function filterTaskReadersNow(
  userIds: number[],
  taskId: number
): Promise<number[]> {
  const uniqueUserIds = [...new Set(userIds)];
  if (uniqueUserIds.length === 0 || !Number.isSafeInteger(taskId) || taskId <= 0) return [];

  const readable = await Promise.all(
    uniqueUserIds.map((userId) => canReadTaskNow(userId, taskId))
  );
  return uniqueUserIds.filter((_, index) => readable[index]);
}
