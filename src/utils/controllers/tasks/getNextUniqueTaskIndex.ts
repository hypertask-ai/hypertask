import type { PrismaClient } from "@prisma/client";

import prisma from "@/lib/prisma";

type TaskIndexDb = Pick<PrismaClient, "task" | "taskNumberAlias" | "project">;

export const getNextUniqueTaskIndex = async (
  projectId: number,
  db: TaskIndexDb = prisma,
): Promise<number> => {
  let next = 0;
  let saved = { count: 0 };
  while (saved.count !== 1) {
    const [tasks, aliases, project] = await Promise.all([
      db.task.aggregate({
        where: { projectId },
        _max: { uniqueIndex: true },
      }),
      db.taskNumberAlias.aggregate({
        where: { projectId },
        _max: { uniqueIndex: true },
      }),
      db.project.findUnique({
        where: { id: projectId },
        select: { issuedUniqueIndex: true },
      }),
    ]);
    if (!project) throw new Error("Board not found while allocating a task number");
    next = Math.max(
      project.issuedUniqueIndex,
      tasks._max.uniqueIndex ?? 0,
      aliases._max.uniqueIndex ?? 0,
    ) + 1;
    saved = await db.project.updateMany({
      where: { id: projectId, issuedUniqueIndex: { lt: next } },
      data: { issuedUniqueIndex: next },
    });
  }
  return next;
};
