import prisma from "@/lib/prisma";
import taskMentionSearch from "./taskMentionSearch";

const tasksSearchAll = async (projectIds: number[], searchQuery__: string) => {
  try {
    if (!projectIds) {
      return {
        status: 200,
        json: [],
      };
    }

    const searchQuery = searchQuery__.replace(/[\s\n\t]/g, "_");
    // const tsquerySpecialChars = /[()|&:*!]/g;

    // const getQueryFromSearchPhrase = (searchPhrase: string) =>
    //   searchPhrase
    //     .replace(tsquerySpecialChars, " ")
    //     .trim()
    //     .split(/\s+/)
    //     .join(" | ");

    // const titleQuery = getQueryFromSearchPhrase(searchQuery__);
    const [otherResponse, tasks] = await Promise.all([
      taskMentionSearch({
        projectIds,
        searchQuery: searchQuery__,
        take: 15,
      }),
      prisma.task.findMany({
        take: 40,
        where: {
          projectId: {
            in: projectIds,
          },
          deletedAt: null,
          OR: [
            {
              ticketNumber: {
                contains: searchQuery.toLowerCase(),
                mode: "insensitive",
              },
            },
            {
              ticketNumber: {
                contains: searchQuery
                  .replace(/([A-Za-z]+)(\d+)/, "$1-$2")
                  .toLowerCase(),
                mode: "insensitive",
              },
            },
            {
              title: {
                contains: searchQuery.toLowerCase(),
                mode: "insensitive",
              },
            },
            {
              // ponytail: ILIKE substring, not full-text `search`. Prisma emits
              // one-arg to_tsvector(description) which recomputes+stems a tsvector
              // per row on every search (no functional index possible — one-arg
              // to_tsvector isn't IMMUTABLE). At board scale that per-row parse is
              // the bulk of the ~350ms. `contains` is a cheap substring filter over
              // the already project-scoped rows and matches partials users expect.
              description: {
                contains: searchQuery.toLowerCase(),
                mode: "insensitive",
              },
            },
            {
              comments: {
                some: {
                  text: {
                    contains: searchQuery.toLowerCase(),
                    mode: "insensitive",
                  },
                },
              },
            },
          ],
        },
        select: {
          id: true,
          projectId: true,
          project: {
            select: {
              title: true,
            },
          },
          title: true,
          uniqueIndex: true,
          description: true,
          user: true,
          archivedAt: true,
          createdAt: true,
          status: true,
          updatedAt: true,
          ticketNumber: true,
          _count: {
            select: {
              comments: {
                where: {
                  creatorId: { not: null },
                },
              },
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
      }),
    ]);

    const combinedResults = [
      ...otherResponse,
      ...tasks.filter(
        (item) => !otherResponse.some((otherItem) => otherItem.id === item.id)
      ),
    ].sort((a, b) => {
      const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return dateB - dateA;
    });

    return {
      status: 200,
      json: combinedResults,
    };
  } catch (error) {
    console.log(error);
    return {
      status: 200,
      json: [],
    };
  }
};

export default tasksSearchAll;
