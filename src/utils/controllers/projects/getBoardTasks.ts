import { stripForeignTaskRelations } from "@/lib/tasks/sameBoardRelations";
import prisma from "@/lib/prisma";
import { teamBillingSnapshotSelect } from "@/lib/ai/teamBillingSnapshotSelect";
import { attachAgentStatus } from "@/utils/controllers/tasks/attachAgentStatus";
import {
  getBoardTaskInclude,
  getProjectIncludeWithoutTasks,
  getProjectViewInclude,
  getProjectWhere,
  getTaskWhere,
  projectBootstrapSelect,
  taskBoardOmit,
} from "./getAllIncludes";
import { sanitizeProjectBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import { attachWaitingOnUsers } from "@/utils/controllers/tasks/attachWaitingOnUsers";
import {
  attachOpenBlockingTasks,
  type TaskWithBlockingRelations,
} from "@/utils/controllers/tasks/attachOpenBlockingTasks";

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

    const project = await prisma.project.findFirst({
      where: { id: projectId, status: "Normal", ...getProjectWhere(userId) },
      select: {
        ...projectBootstrapSelect,
        sections: true,
        seeded: true,
        targetDate: true,
        ...getProjectIncludeWithoutTasks({
          userId,
          userDbId: userId,
          currentUserId,
        }),
        team: {
          select: {
            ...teamBillingSnapshotSelect,
            totalSeats: true,
            googleAccountId: true,
            stripe_customer_id: true,
            allowedEmailDomains: true,
            googleAccount: { select: { userId: true } },
            team_activity: { select: { hasCompletedTrial: true } },
          },
        },
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
        ...getBoardTaskInclude({ userId, userDbId: userId, currentUserId, includeCachedDescription: true }),
        customFieldValues: {
          select: { fieldId: true, value: true, numericValue: true },
        },
      },
    });
    const tasksWithOpenBlockers = await attachOpenBlockingTasks(
      tasks as Array<(typeof tasks)[number] & TaskWithBlockingRelations>,
    );
    const tasksWithWaitingOnUsers = await attachWaitingOnUsers(tasksWithOpenBlockers);

    const tasksWithAgentStatus = await attachAgentStatus(tasksWithWaitingOnUsers);

    const sanitizedProject = sanitizeProjectBoardFilters(project, currentUserId ?? userId);
    const { allViews = [], ...projectView } =
      sanitizedProject.project_view ?? {};
    const projectPayload = sanitizedProject.project_view
      ? { ...sanitizedProject, project_view: projectView }
      : sanitizedProject;

    return {
      status: 200,
      json: {
        project: projectPayload,
        tasks: tasksWithAgentStatus.map(stripForeignTaskRelations),
        allViews,
      },
    };
  } catch (error) {
    console.log("getBoardTasks error:", error);
    return { status: 400, json: { message: JSON.stringify(error) } };
  }
};

export default getBoardTasks;
