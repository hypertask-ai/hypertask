import { stripForeignTaskRelations } from "@/lib/tasks/sameBoardRelations";
import prisma from "@/lib/prisma";
import {
  getFullTaskInclude,
  getProjectWhere,
  taskBoardOmit,
} from "@/utils/controllers/projects/getAllIncludes";
import { attachWaitingOnUsers } from "./attachWaitingOnUsers";

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
      json: await attachWaitingOnUsers(tasks.map(stripForeignTaskRelations)),
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
