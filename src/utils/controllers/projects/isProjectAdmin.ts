import prisma from "@/lib/prisma";

const isProjectAdmin = async (userId: number, projectId: number): Promise<boolean> => {
  const project = await prisma.project.findFirst({
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
