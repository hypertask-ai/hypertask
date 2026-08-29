import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

/**
 * Fresh authorization boundary for locally cached Inbox rows.
 *
 * The response intentionally contains IDs only. Cached notification content is
 * not rendered until its board is still readable by the signed-in user.
 */
export const getInboxAccessibleProjectIds = async (
  userId: number,
): Promise<number[]> => {
  const projects = await prisma.project.findMany({
    where: {
      status: "Normal",
      ...projectContentAccessWhere(userId),
    },
    select: { id: true },
  });

  return projects.map(({ id }) => id);
};

