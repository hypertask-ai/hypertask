import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

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

