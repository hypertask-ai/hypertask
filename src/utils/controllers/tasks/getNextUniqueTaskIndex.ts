import type { PrismaClient } from "@prisma/client";

import prisma from "@/lib/prisma";

type TaskIndexDb = Pick<PrismaClient, "task">;

export const getNextUniqueTaskIndex = async (
  projectId: number,
  db: TaskIndexDb = prisma,
): Promise<number> => {
  const result = await db.task.aggregate({
    where: { projectId },
    _max: { uniqueIndex: true },
  });

  return (result._max.uniqueIndex ?? 0) + 1;
};

