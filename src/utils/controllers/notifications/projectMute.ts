import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

type NotificationDatabase = Prisma.TransactionClient | typeof prisma;

export async function isProjectMuted(
  userId: number,
  projectId: number,
  database: NotificationDatabase = prisma,
): Promise<boolean> {
  const mute = await database.projectMute.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { id: true },
  });

  return Boolean(mute);
}

export async function isTaskProjectMuted(
  userId: number,
  taskId: number,
  database: NotificationDatabase = prisma,
): Promise<boolean> {
  const mute = await database.projectMute.findFirst({
    where: {
      userId,
      project: { tasks: { some: { id: taskId } } },
    },
    select: { id: true },
  });

  return Boolean(mute);
}

export async function filterProjectMutedUserIds(
  userIds: number[],
  projectId: number,
  database: NotificationDatabase = prisma,
): Promise<number[]> {
  if (userIds.length === 0) return [];

  const mutes = await database.projectMute.findMany({
    where: { projectId, userId: { in: userIds } },
    select: { userId: true },
  });
  const mutedUserIds = new Set(mutes.map((mute) => mute.userId));

  return userIds.filter((userId) => !mutedUserIds.has(userId));
}
