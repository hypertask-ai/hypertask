import prisma from "@/lib/prisma";
import {
  getBoardTaskInclude,
  getProjectIncludeWithoutTasks,
  getProjectViewInclude,
  getProjectWhere,
  getTaskWhere,
  taskBoardOmit,
} from "./getAllIncludes";
import { sanitizeProjectBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";

/**
 * Tasks/views for one board in the BoardTasksPayload client contract. The
 * server projection is intentionally narrower than task detail: hydration
 * restores the full board model from metadata + this payload. See HTPR-3811.
 */
const getBoardTasks = async (
  project_id: any,
  user_id: any,
  currentUserId?: number
) => {
  const projectId = parseInt(project_id?.toString());
  const userId = parseInt(user_id?.toString());
  try {
    if (!projectId || !userId) {
      return { status: 400, json: { message: "projectId and userId are required" } };
    }

    // Access guard: only owners/members of the board may read its board payload.
    const project = await prisma.project.findFirst({
      where: { id: projectId, status: "Normal", ...getProjectWhere(userId) },
      include: {
        ...getProjectIncludeWithoutTasks({
          userId,
          userDbId: userId,
          currentUserId,
        }),
        project_view: getProjectViewInclude({ currentUserId }),
      },
    });
    if (!project) {
      return { status: 403, json: { message: "No access to this board" } };
    }

    const tasks = await prisma.task.findMany({
      where: { projectId, ...getTaskWhere() },
      omit: taskBoardOmit,
      include: {
        ...getBoardTaskInclude({ userId, userDbId: userId, currentUserId }),
        customFieldValues: {
          select: { fieldId: true, value: true, numericValue: true },
        },
      },
    });

    const sanitizedProject = sanitizeProjectBoardFilters(project);
    const { allViews = [], ...projectView } =
      sanitizedProject.project_view ?? {};
    const projectPayload = sanitizedProject.project_view
      ? { ...sanitizedProject, project_view: projectView }
      : sanitizedProject;

    return {
      status: 200,
      json: {
        project: projectPayload,
        tasks,
        allViews,
      },
    };
  } catch (error) {
    console.log("getBoardTasks error:", error);
    return { status: 400, json: { message: JSON.stringify(error) } };
  }
};

export default getBoardTasks;
