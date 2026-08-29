import type { PrismaClient } from "@prisma/client";

import prisma from "@/lib/prisma";

type TaskIndexDb = Pick<PrismaClient, "task">;

/**
 * Return the next project-scoped task index with one indexed aggregate query.
 * Callers that create a task must still serialize allocation (the web route
 * uses its existing project advisory lock) or rely on the unique constraint.
 */
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

