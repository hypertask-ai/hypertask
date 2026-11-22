import type { PrismaClient } from "@prisma/client";

import prisma from "@/lib/prisma";

const ALLOCATION_ATTEMPTS = 8;

type TaskIndexDb = Pick<PrismaClient, "task" | "taskNumberAlias" | "project">;

export const getNextUniqueTaskIndex = async (
  projectId: number,
  db: TaskIndexDb = prisma,
): Promise<number> => {
  for (let attempt = 0; attempt < ALLOCATION_ATTEMPTS; attempt += 1) {
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
    const next = Math.max(
      project.issuedUniqueIndex,
      tasks._max.uniqueIndex ?? 0,
      aliases._max.uniqueIndex ?? 0,
    ) + 1;
    const saved = await db.project.updateMany({
      where: { id: projectId, issuedUniqueIndex: { lt: next } },
      data: { issuedUniqueIndex: next },
    });
    if (saved.count === 1) return next;
  }
  throw new Error("Board task number changed while it was being allocated");
};
