import type { PrismaClient } from "@prisma/client";

import prisma from "@/lib/prisma";

type TaskIndexDb = Pick<PrismaClient, "task"> & Partial<Pick<PrismaClient, "taskNumberAlias">>;

export const getNextUniqueTaskIndex = async (
  projectId: number,
  db: TaskIndexDb = prisma,
): Promise<number> => {
  const [tasks, aliases] = await Promise.all([
    db.task.aggregate({ where: { projectId }, _max: { uniqueIndex: true } }),
    db.taskNumberAlias?.aggregate
      ? db.taskNumberAlias.aggregate({ where: { projectId }, _max: { uniqueIndex: true } })
      : Promise.resolve({ _max: { uniqueIndex: null } }),
  ]);
  return Math.max(tasks._max.uniqueIndex ?? 0, aliases._max.uniqueIndex ?? 0) + 1;
};

