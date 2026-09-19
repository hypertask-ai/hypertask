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
import { attachWaitingOnUsers } from "@/utils/controllers/tasks/attachWaitingOnUsers";
import {
  attachOpenBlockingTasks,
  type TaskWithBlockingRelations,
} from "@/utils/controllers/tasks/attachOpenBlockingTasks";
import {
  HTPR_6516_AGENT_ATTRIBUTION_FLAG,
  HTPR_6588_EMPTY_COLUMNS_SAVE_VIEW_FLAG,
  isFeatureEnabled,
} from "@/lib/flags";
import { sanitizeAgentAssigneeOwner } from "@/lib/assignees";
import type { IProjectView } from "@/models/model";
import { maskPersonalEmptySectionsForUnsavedView } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";

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

    const attributionEnabled = await isFeatureEnabled(
      HTPR_6516_AGENT_ATTRIBUTION_FLAG,
      userId,
    );
    const emptyColumnsSaveViewEnabled =
      !!project.project_view?.user_project_views[0]?.unsavedView &&
      await isFeatureEnabled(HTPR_6588_EMPTY_COLUMNS_SAVE_VIEW_FLAG, userId);
    const tasks = await prisma.task.findMany({
      where: { projectId, ...getTaskWhere() },
      omit: taskBoardOmit,
      include: {
        ...getBoardTaskInclude({
          userId,
          userDbId: userId,
          currentUserId,
          attributionEnabled,
        }),
        customFieldValues: {
          select: { fieldId: true, value: true, numericValue: true },
        },
      },
    });
    const tasksWithOpenBlockers = await attachOpenBlockingTasks(
      tasks as Array<(typeof tasks)[number] & TaskWithBlockingRelations>,
    );
    const tasksWithWaitingOnUsers = await attachWaitingOnUsers(tasksWithOpenBlockers);
    const serializedTasks = attributionEnabled
      ? tasksWithWaitingOnUsers.map((task) => ({
          ...task,
          assignees: task.assignees.map(sanitizeAgentAssigneeOwner),
        }))
      : tasksWithWaitingOnUsers;

    const sanitizedProject = sanitizeProjectBoardFilters(project);
    if (emptyColumnsSaveViewEnabled && sanitizedProject.project_view) {
      sanitizedProject.project_view = maskPersonalEmptySectionsForUnsavedView(
        sanitizedProject.project_view as unknown as IProjectView,
      ) as unknown as typeof sanitizedProject.project_view;
    }
    const { allViews = [], ...projectView } =
      sanitizedProject.project_view ?? {};
    const projectPayload = sanitizedProject.project_view
      ? { ...sanitizedProject, project_view: projectView }
      : sanitizedProject;

    return {
      status: 200,
      json: {
        project: projectPayload,
        tasks: serializedTasks,
        allViews,
      },
    };
  } catch (error) {
    console.log("getBoardTasks error:", error);
    return { status: 400, json: { message: JSON.stringify(error) } };
  }
};

export default getBoardTasks;
