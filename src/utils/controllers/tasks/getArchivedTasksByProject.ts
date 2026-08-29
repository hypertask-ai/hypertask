import prisma from "@/lib/prisma";
import {
  getFullTaskInclude,
  getProjectWhere,
  taskBoardOmit,
} from "@/utils/controllers/projects/getAllIncludes";

// The board's show-archived toggle asks for every archived card on the project
// at once, with the full task include (assignees, labels, subtasks, comments
// counts). getArchivedTasks.ts, the analogous inbox-side query, has always been
// paged; this one was not, so a long-lived board's payload grew without bound
// (HTPR-3963). Newest-archived first is the useful end of that list, so cap it
// rather than build a load-more the toggle has no UI for. Raise this, or switch
// to the cursor pattern in getArchivedTasks.ts, when someone needs deeper history.
const ARCHIVED_TASKS_LIMIT = 100;

const tasksGetArchivedTasksByProject = async (
  projectId: number | string | string[],
  userId: number | string
) => {
  try {
    const parsedProjectId = parseInt(projectId as string);
    const parsedUserId = parseInt(userId as string);

    if (!parsedProjectId || !parsedUserId) {
      return {
        status: 200,
        json: [],
      };
    }

    const user = await prisma.user.findUnique({
      where: {
        id: parsedUserId,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      return {
        status: 400,
        json: { message: "User not found" },
      };
    }

    const tasks = await prisma.task.findMany({
      where: {
        projectId: parsedProjectId,
        status: "Archive",
        project: {
          status: "Normal",
          ...getProjectWhere(parsedUserId),
        },
      },
      omit: taskBoardOmit,
      include: getFullTaskInclude({
        userId: parsedUserId,
        userDbId: user.id,
        currentUserId: user.id,
      }),
      take: ARCHIVED_TASKS_LIMIT,
      orderBy: [
        {
          archivedAt: {
            sort: "desc",
            nulls: "last",
          },
        },
        {
          updatedAt: {
            sort: "desc",
            nulls: "last",
          },
        },
      ],
    });

    return {
      status: 200,
      json: tasks,
    };
  } catch (error) {
    console.log(error);
    return {
      status: 400,
      json: { message: JSON.stringify(error) },
    };
  }
};

export default tasksGetArchivedTasksByProject;
