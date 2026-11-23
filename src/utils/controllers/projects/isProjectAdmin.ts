import prisma from "@/lib/prisma";

const isProjectAdmin = async (
  userId: number,
  projectId: number,
  database: { project: Pick<typeof prisma.project, "findFirst"> } = prisma,
): Promise<boolean> => {
  const project = await database.project.findFirst({
    where: {
      id: projectId,
      OR: [
        { ownerId: userId },
        {
          members: {
            some: {
              userId,
              status: "Accepted",
              agentId: null,
              role: "Admin",
            },
          },
        },
      ],
    },
  });

  return Boolean(project);
};

export default isProjectAdmin;
