import prisma from "@/lib/prisma";

export type WaitingOnUserSummary = {
  id: number;
  displayName: string | null;
  photoURL: string | null;
};

type TaskWithWaitingOnUserId = {
  waitingOnUserId?: number | null;
};

export const attachWaitingOnUsers = async <T extends TaskWithWaitingOnUserId>(
  tasks: T[],
): Promise<Array<T & { waitingOnUser: WaitingOnUserSummary | null }>> => {
  const userIds = [
    ...new Set(
      tasks.flatMap((task) =>
        task.waitingOnUserId == null ? [] : [task.waitingOnUserId],
      ),
    ),
  ];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, displayName: true, photoURL: true },
      })
    : [];
  const usersById = new Map(users.map((user) => [user.id, user]));

  return tasks.map((task) => ({
    ...task,
    waitingOnUser:
      task.waitingOnUserId == null
        ? null
        : (usersById.get(task.waitingOnUserId) ?? null),
  }));
};
