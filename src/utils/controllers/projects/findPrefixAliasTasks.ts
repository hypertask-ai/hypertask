import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

export async function findPrefixAliasTasks(
  ticketNumber: string,
  projectAccess: Prisma.ProjectWhereInput,
  projectId?: number | null,
) {
  const match = /^([A-Z0-9]+)-(\d+)$/i.exec(ticketNumber);
  if (!match) return [];
  const uniqueIndex = Number(match[2]);
  if (!Number.isSafeInteger(uniqueIndex) || uniqueIndex <= 0) return [];
  const aliases = await prisma.projectPrefixAlias.findMany({
    where: {
      prefix: { equals: match[1].toUpperCase(), mode: "insensitive" },
      ...(projectId ? { projectId } : {}),
      project: { status: { not: "Deleted" } },
    },
    select: { projectId: true },
  });
  if (!aliases.length) return [];
  const identity = { projectId: { in: aliases.map((alias) => alias.projectId) }, uniqueIndex };
  const taskAccess: Prisma.TaskWhereInput = {
    status: { not: "Deleted" },
    project: { AND: [projectAccess, { status: { not: "Deleted" } }] },
  };
  const tasks = await prisma.task.findMany({
    where: { ...identity, ...taskAccess },
    select: { id: true, projectId: true, uniqueIndex: true },
    orderBy: [{ projectId: "asc" }, { id: "asc" }],
    take: 2,
  });
  const moved = await prisma.taskNumberAlias.findMany({
    where: { ...identity, task: taskAccess },
    select: { projectId: true, task: { select: { id: true, projectId: true, uniqueIndex: true } } },
    orderBy: [{ projectId: "asc" }, { id: "asc" }],
  });
  if (!moved.length) return tasks;
  // A reused source number must not redirect to a different, moved task.
  const reused = await prisma.task.findMany({
    where: { ...identity, status: { not: "Deleted" } },
    select: { projectId: true },
  });
  const available = moved.filter(alias => !reused.some(task => task.projectId === alias.projectId));
  return [...new Map([...tasks, ...available.map(alias => alias.task)].map(task => [task.id, task])).values()].slice(0, 2);
}
