import prisma from "@/lib/prisma";
import taskMentionSearch from "./taskMentionSearch";

const taskSearchSelect = {
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
} as const;

export const exactTaskReferenceWhere = (rawQuery: string) => {
  const query = rawQuery.trim();
  if (/^\d+$/.test(query)) {
    const uniqueIndex = Number(query);
    return Number.isSafeInteger(uniqueIndex) && uniqueIndex > 0
      ? { uniqueIndex }
      : null;
  }

  const ticket = query.match(/^([a-z]{2,10})[-\s]?(\d{1,7})$/i);
  if (!ticket) return null;
  const uniqueIndex = Number(ticket[2]);
  if (!Number.isSafeInteger(uniqueIndex) || uniqueIndex <= 0) return null;
  return {
    ticketNumber: {
      equals: `${ticket[1].toUpperCase()}-${uniqueIndex}`,
      mode: "insensitive" as const,
    },
  };
};

export const combineTaskSearchResults = <
  T extends { id: number; updatedAt: Date | string | null },
>(exactTasks: T[], mentionedTasks: T[], matchingTasks: T[]) => {
  const exactIds = new Set(exactTasks.map((task) => task.id));
  const seen = new Set<number>();
  return [...exactTasks, ...mentionedTasks, ...matchingTasks]
    .filter((task) => {
      if (seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    })
    .sort((a, b) => {
      const exactOrder =
        Number(exactIds.has(b.id)) - Number(exactIds.has(a.id));
      if (exactOrder !== 0) return exactOrder;
      const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return dateB - dateA;
    });
};

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
    const exactReference = exactTaskReferenceWhere(searchQuery__);
    const [exactTasks, otherResponse, tasks] = await Promise.all([
      exactReference
        ? prisma.task.findMany({
            where: {
              projectId: {
                in: projectIds,
              },
              deletedAt: null,
              ...exactReference,
            },
            select: taskSearchSelect,
            orderBy: {
              updatedAt: "desc",
            },
          })
        : Promise.resolve([]),
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
        select: taskSearchSelect,
        orderBy: {
          updatedAt: "desc",
        },
      }),
    ]);

    const combinedResults = combineTaskSearchResults(
      exactTasks,
      otherResponse,
      tasks,
    );

    return {
      status: 200,
      json: combinedResults,
    };
  } catch (error) {
    console.log(error);
    return {
      status: 500,
      json: [],
    };
  }
};

export default tasksSearchAll;
