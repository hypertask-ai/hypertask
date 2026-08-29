import prisma from "@/lib/prisma";
export const includeSavedContentComment = (
  userId: number,
  comment: boolean = true
): any => {
  const baseInclude: any = {
    include: {
      notifications: {
        where: {
          status: "Normal",
          userId,
        },
        select: {
          seen: true,
          id: true,
          userId: true,
          taskId: true,
          type: true,
        },
        take: 1,
        orderBy: {
          createdAt: "desc",
        },
      },
      _count: {
        select: {
          comments: {
            where: {
              creatorId: { not: null },
            },
          },
        },
      },
      project: {
        select: {
          name: true,
          title: true,
          teamId: true,
          team: {
            select: {
              title: true,
            },
          },
        },
      },
    },
  };

  // Now TypeScript won't complain when adding a property
  if (comment) {
    baseInclude.include.comments = {
      select: {
        id: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    };
  }

  return baseInclude;
};

export const fetchProjectIds = async (userId: number) => {
  const projectIds = await prisma.project.findMany({
    where: {
      OR: [
        {
          members: {
            some: {
              userId,
            },
          },
        },
        {
          ownerId: {
            in: [userId],
          },
        },
      ],
    },
    select: {
      id: true,
    },
  });

  const idArray = projectIds
    .map((obj: any) => Object.values(obj))
    .flat() as number[];

  return idArray;
};
