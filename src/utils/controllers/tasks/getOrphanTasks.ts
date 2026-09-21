import prisma from "@/lib/prisma";

const SearchForOrphanTasks = async (
  projectId: number,
  currentTaskId: number,
  searchQuery: string
) => {
  const take = 10;
  const baseWhereCondition = {
    id: {
      not: currentTaskId,
    },
    projectId: projectId,
    deletedAt: null,
    parentTask: null,
  };
  const select = {
    id: true,
    projectId: true,
    title: true,
    uniqueIndex: true,
    description: true,
    user: true,
    archivedAt: true,
    ticketNumber: true,
    createdAt: true,
    status: true,
    updatedAt: true,
    subTasks: true,
  };
  const orphans = searchQuery
    ? await prisma.task.findMany({
        take,
        where: {
          ...baseWhereCondition,
          OR: [
            {
              title: {
                contains: searchQuery,
                mode: "insensitive",
              },
            },
            {
              ticketNumber: {
                contains: searchQuery,
                mode: "insensitive",
              },
            },
          ],
        },
        select,
        orderBy: {
          createdAt: "desc",
        },
      })
    : await prisma.task.findMany({
        take,
        where: {
          ...baseWhereCondition,
        },
        select,
        orderBy: {
          createdAt: "desc",
        },
      });

  console.log("🚀 ~ SearchForOrphanTasks ~ orphans:", orphans);

  return {
    status: 200,
    json: orphans,
  };
};

export default SearchForOrphanTasks;
