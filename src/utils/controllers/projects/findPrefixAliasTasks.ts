import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

export async function findPrefixAliasTasks(
  ticketNumber: string,
  projectAccess: Prisma.ProjectWhereInput,
  projectId?: number | null,
) {
  const match = /^([A-Z0-9]+)-(\d+)$/.exec(ticketNumber);
  if (!match) return [];
  const uniqueIndex = Number(match[2]);
  if (!Number.isSafeInteger(uniqueIndex) || uniqueIndex <= 0) return [];
  const aliases = await prisma.projectPrefixAlias.findMany({
    where: {
      prefix: match[1],
      ...(projectId ? { projectId } : {}),
      project: { AND: [projectAccess, { status: { not: "Deleted" } }] },
    },
    select: { projectId: true },
  });
  if (!aliases.length) return [];
  return prisma.task.findMany({
    where: {
      projectId: { in: aliases.map((alias) => alias.projectId) },
      uniqueIndex,
      status: { not: "Deleted" },
      project: { AND: [projectAccess, { status: { not: "Deleted" } }] },
    },
    select: { id: true, projectId: true, uniqueIndex: true },
    orderBy: [{ projectId: "asc" }, { id: "asc" }],
    take: 2,
  });
}
