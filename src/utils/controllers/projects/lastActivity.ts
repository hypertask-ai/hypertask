import prisma from "@/lib/prisma";
import { extraMinimalProjectWhere } from "./getAllMinimal";

/**
 * Most recent task update per board the user can see.
 *
 * The board switcher listed boards in creation order, which reads as random
 * once an account has more than a handful (HTPR-5476). Activity is derived
 * rather than stored: Project has no updatedAt, and adding one would need
 * every task write to touch its board row.
 *
 * This is deliberately its own endpoint instead of a field on the board
 * bootstrap payload — it runs when the switcher opens, not on every board
 * load.
 */
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
