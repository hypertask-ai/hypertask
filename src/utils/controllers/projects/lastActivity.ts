import prisma from "@/lib/prisma";
import { extraMinimalProjectWhere } from "./getAllMinimal";

const getProjectsLastActivity = async (userId: number) => {
  if (!userId) return { status: 400, json: {} };

  const projects = await prisma.project.findMany({
    where: extraMinimalProjectWhere(userId),
    select: { id: true },
  });
  if (projects.length === 0) return { status: 200, json: {} };

  const rows = await prisma.task.groupBy({
    by: ["projectId"],
    where: {
      projectId: { in: projects.map((project) => project.id) },
      deletedAt: null,
    },
    _max: { updatedAt: true },
  });

  const lastActivity: Record<number, string | null> = {};
  for (const row of rows) {
    lastActivity[row.projectId] = row._max.updatedAt?.toISOString() ?? null;
  }
  return { status: 200, json: lastActivity };
};

export default getProjectsLastActivity;
