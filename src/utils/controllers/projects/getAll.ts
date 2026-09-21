import { logger as htLogger } from "#logger";

import {
  HTPR_6588_EMPTY_COLUMNS_SAVE_VIEW_FLAG,
  isFeatureEnabled,
} from "@/lib/flags";
import prisma from "@/lib/prisma";
import type { IProjectView } from "@/models/model";
import {
  getProjectIncludeWithoutTasks,
  getProjectWhere,
  projectBootstrapSelect,
} from "./getAllIncludes";
import { persistDisabledStagedEmptySections } from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";
import { sanitizeProjectBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import { maskPersonalEmptySectionsForUnsavedView } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";

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
    // Board bootstrap lists compact authorized projects. The parallel boardTasks
    // request supplies the active board's full metadata, views, and tasks; other
    // boards hydrate lazily on first open. See HTPR-3811.
    // HTPR-4478: this fires on every project page load. The user lookup and the
    // project fetch are independent (userDbId === userId here, since the user is
    // fetched by that id), so run them concurrently instead of sequentially.
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

    const emptyColumnsSaveViewEnabled =
      !hasActiveProject &&
      await isFeatureEnabled(HTPR_6588_EMPTY_COLUMNS_SAVE_VIEW_FLAG, userId);

    return {
      status: 200,
      json: await Promise.all(projects.map(async (project) => {
        const sanitizedProject = sanitizeProjectBoardFilters(project);
        if (
          !("project_view" in sanitizedProject) ||
          !sanitizedProject.project_view
        ) {
          return sanitizedProject;
        }
        const projectView = sanitizedProject.project_view as unknown as IProjectView;
        if (!projectView.user_project_views[0]?.unsavedView) {
          return sanitizedProject;
        }
        return {
          ...sanitizedProject,
          project_view: (
            emptyColumnsSaveViewEnabled
              ? maskPersonalEmptySectionsForUnsavedView(projectView, true)
              : await persistDisabledStagedEmptySections(projectView, userId)
          ) as unknown as typeof sanitizedProject.project_view,
        };
      })),
    };
  } catch (error) {
    htLogger.info(error);
    return {
      status: 400,
      json: { message: JSON.stringify(error) },
    };
  }
};

export default getAll;

export { getProjectViewInclude } from "./getAllIncludes";
