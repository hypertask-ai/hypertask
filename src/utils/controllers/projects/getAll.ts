
import prisma from "@/lib/prisma";
import {
  getProjectIncludeWithoutTasks,
  getProjectWhere,
  projectBootstrapSelect,
} from "./getAllIncludes";
import { sanitizeProjectBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";

const getAll = async (
  user_id: any,
  currentUserId?: number,
  activeProjectId?: number
) => {
  const userId = parseInt(user_id.toString());
  try {
    if (!userId) {
      return {
        status: 200,
        json: { message: "User id is required" },
      };
    }
    const projectWhere = {
      status: "Normal" as const,
      ...getProjectWhere(userId),
    };
    const parsedActiveProjectId = Number(activeProjectId);
    const hasActiveProject =
      Number.isInteger(parsedActiveProjectId) && parsedActiveProjectId > 0;
    const [user, projects] = await Promise.all([
      prisma.user.findUnique({
        where: {
          id: userId,
        },
      }),
      hasActiveProject
        ? prisma.project.findMany({
            where: projectWhere,
            select: projectBootstrapSelect,
            orderBy: { id: "asc" },
          })
        : prisma.project.findMany({
            where: projectWhere,
            include: getProjectIncludeWithoutTasks({
              userId,
              userDbId: userId,
              currentUserId,
            }),
            orderBy: { id: "asc" },
          }),
    ]);
    if (!user) {
      return {
        status: 400,
        json: { message: "User not found" },
      };
    }

    return {
      status: 200,
      json: projects.map((project) => sanitizeProjectBoardFilters(project, currentUserId ?? userId)),
    };
  } catch (error) {
    console.log(error);
    return {
      status: 400,
      json: { message: JSON.stringify(error) },
    };
  }
};

export default getAll;

export { getProjectViewInclude } from "./getAllIncludes";
