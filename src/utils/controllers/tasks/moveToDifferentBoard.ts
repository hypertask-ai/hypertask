/**
 * Service to move a task (and its subtasks) from one board/project to another.
 * Used by Pages API /api/tasks/move-task-to-different-board and MCP API POST /mcp/tasks/move.
 */
import prisma from "@/lib/prisma";
import getMemberAndOwner from "@/utils/controllers/getMemberAndOwnerForBoard";
import generateRank from "@/utils/generateRank";
import { getUniqueTaskCount } from "@/utils/controllers/tasks/create";
import {
  cancelDueDateJob,
  scheduleDueDateJob,
} from "@/pages/api/queues/duedateQueue";
import { subMinutes } from "date-fns";
import {
  TASK_IDENTITY_CONFLICT_CODE,
  updateTaskSingle,
} from "@/utils/controllers/tasks/single";
import { IUser } from "@/models/model";
import { toErrorMessage } from "@/lib/api/errorMessage";
import { autoAssignForSection } from "@/utils/controllers/assignees/autoAssignForSection";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

const TASK_IDENTITY_ALLOCATION_ATTEMPTS = 3;

async function getTaskWithNestedSubtasks(taskId: number): Promise<any> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      subTasks: { include: { subTasks: true } },
    },
  });
  if (!task) return null;
  if (task.subTasks?.length > 0) {
    task.subTasks = await Promise.all(
      task.subTasks.map((st) => getTaskWithNestedSubtasks(st.id))
    );
  }
  return task;
}

async function getProjectData(projectId: number, currentProjectId: number, sectionId: number) {
  const [newProject, currentProject, section] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId } }),
    prisma.project.findUnique({ where: { id: currentProjectId }, select: { teamId: true } }),
    prisma.section.findUnique({ where: { id: sectionId } }),
  ]);
  return { newProject, currentProject, section };
}

async function getNewTaskRanking(sectionId: number, projectId: number) {
  const lastTask = await prisma.task.findFirst({
    where: { sectionId, projectId },
    orderBy: { ranking: "asc" },
  });
  return generateRank(undefined, lastTask?.ranking);
}

async function moveTaskWithDestinationIdentity({
  taskId,
  projectId,
  sectionId,
  sectionTitle,
  projectIdentifier,
  parentTaskId,
  currentUser,
  agentId,
}: {
  taskId: number;
  projectId: number;
  sectionId: number;
  sectionTitle: string;
  projectIdentifier: string;
  parentTaskId: number | null;
  currentUser: IUser;
  agentId?: string | null;
}) {
  for (let attempt = 0; attempt < TASK_IDENTITY_ALLOCATION_ATTEMPTS; attempt++) {
    const [taskCount, ranking] = await Promise.all([
      getUniqueTaskCount(projectId),
      getNewTaskRanking(sectionId, projectId),
    ]);
    const result = await updateTaskSingle(
      {
        id: taskId,
        projectId,
        cycleId: null,
        sectionId,
        ranking,
        section: sectionTitle,
        uniqueIndex: taskCount + 1,
        ticketNumber: `${projectIdentifier}-${taskCount + 1}`,
        updatedAt: new Date(),
        parentTaskId,
      },
      currentUser,
      agentId,
      {
        allowProjectChange: true,
        skipAutoAssign: true,
        // Relocating a task is not completing it: without this, moving a
        // recurring task into another board's done column would fork a copy
        // onto the destination board (HTPR-4885).
        skipRecurrence: true,
      },
    );
    if (
      result.status === 200 ||
      result.json?.code !== TASK_IDENTITY_CONFLICT_CODE ||
      attempt === TASK_IDENTITY_ALLOCATION_ATTEMPTS - 1
    ) {
      return result;
    }
  }
  throw new Error("Task identity allocation attempts must be positive");
}

async function moveAllSubtasksRecursively(
  subtasks: any[],
  projectId: number,
  sectionId: number,
  projectIdentifier: string,
  parentTaskId: number,
  currentUser: IUser,
  agentId?: string | null
) {
  const section = await prisma.section.findUnique({ where: { id: sectionId } });
  for (const subtask of subtasks) {
    const result = await moveTaskWithDestinationIdentity({
      taskId: subtask.id,
      projectId,
      sectionId,
      sectionTitle: section?.section_title ?? "",
      projectIdentifier,
      parentTaskId,
      currentUser,
      agentId,
    });
    if (result.status !== 200) {
      throw new Error(toErrorMessage(result.json, "Failed to move subtask"));
    }
    if (subtask.subTasks?.length > 0) {
      await moveAllSubtasksRecursively(
        subtask.subTasks,
        projectId,
        sectionId,
        projectIdentifier,
        subtask.id,
        currentUser,
        agentId
      );
    }
  }
}

async function checkUserTeamMembership(userId: number, teamId: string) {
  const member = await prisma.member_Team.findFirst({ where: { userId, teamId } });
  return !!member;
}

async function cleanupTaskForTeamSwitch(taskId: number, userId: number, memberCheck: boolean) {
  if (!memberCheck) {
    await prisma.task.update({ where: { id: taskId }, data: { userId } });
  }
}

async function handleTeamSwitchForTaskRecursively(task: any, currentUserId: number, newProject: any) {
  const memberCheck = await checkUserTeamMembership(task.userId, newProject.teamId);
  await cleanupTaskForTeamSwitch(task.id, currentUserId, memberCheck);
  if (task.subTasks?.length > 0) {
    await Promise.all(
      task.subTasks.map((st: any) => handleTeamSwitchForTaskRecursively(st, currentUserId, newProject))
    );
  }
}

async function updateTaskRelatedData(taskId: number, projectId: number, sectionId: number) {
  await Promise.all([
    prisma.estimate.updateMany({ where: { taskId }, data: { projectId, sectionId } }),
    prisma.priority.updateMany({ where: { taskId }, data: { projectId, sectionId } }),
  ]);
}

async function updateTaskRelatedDataRecursively(task: any, projectId: number, sectionId: number) {
  await updateTaskRelatedData(task.id, projectId, sectionId);
  if (task.subTasks?.length > 0) {
    await Promise.all(
      task.subTasks.map((st: any) => updateTaskRelatedDataRecursively(st, projectId, sectionId))
    );
  }
}

async function updateSavedContent(taskId: number, newProjectId: number, oldProjectId: number) {
  await prisma.savedContent.updateMany({
    where: { taskId, projectId: oldProjectId },
    data: { projectId: newProjectId },
  });
}

async function updateAllSavedContentRecursively(task: any, newProjectId: number, oldProjectId: number) {
  await updateSavedContent(task.id, newProjectId, oldProjectId);
  if (task.subTasks?.length > 0) {
    await Promise.all(
      task.subTasks.map((st: any) => updateAllSavedContentRecursively(st, newProjectId, oldProjectId))
    );
  }
}

async function updateDueDateQueue(task: any, oldProjectId: number) {
  await cancelDueDateJob(task.id, oldProjectId);
  try {
    if (task.dueDate) {
      const dueDate = new Date(task.dueDate);
      if (dueDate > new Date()) {
        await scheduleDueDateJob(
          { taskId: task.id, projectId: task.projectId },
          subMinutes(dueDate, 0)
        );
      }
    }
  } catch (e) {
    console.log("[moveToDifferentBoard] updateDueDateQueue error:", e);
  }
}

async function updateDueDateQueueRecursively(task: any, oldProjectId: number, newProjectId: number) {
  await updateDueDateQueue(task, oldProjectId);
  if (task.subTasks?.length > 0) {
    await Promise.all(
      task.subTasks.map((st: any) => updateDueDateQueueRecursively(st, oldProjectId, newProjectId))
    );
  }
}

function getAllTaskIdsRecursively(task: any): number[] {
  const ids = [task.id];
  if (task.subTasks?.length > 0) {
    for (const subtask of task.subTasks) {
      ids.push(...getAllTaskIdsRecursively(subtask));
    }
  }
  return ids;
}

async function duplicateTags(taskId: number, newProjectId: number) {
  const taskLabels = await prisma.taskLabel.findMany({ where: { taskId }, include: { label: true } });
  for (const taskLabel of taskLabels) {
    await prisma.taskLabel.delete({ where: { id: taskLabel.id } });
    const existingLabel = await prisma.label.findFirst({
      where: { projectId: newProjectId, value: taskLabel.label.value },
    });
    if (existingLabel) {
      await prisma.taskLabel.create({ data: { taskId, labelId: existingLabel.id } });
    } else {
      await prisma.label.create({
        data: { value: taskLabel.label.value, projectId: newProjectId, task: { create: { taskId } } },
      });
    }
  }
}

async function unAssignMembersNotInNewBoard(taskId: number, newProjectId: number) {
  const allowedMembers = await getMemberAndOwner(newProjectId);
  if (typeof allowedMembers === "string") return;
  const [assignees, followers] = await Promise.all([
    prisma.assignees.findMany({ where: { taskId } }),
    prisma.follower.findMany({ where: { taskId } }),
  ]);
  // Batch delete unallowed assignees and followers for better performance
  const unallowedAssigneeIds = assignees
    .filter(a => !allowedMembers.includes(a.userId))
    .map(a => a.id);

  const unallowedFollowerIds = followers
    .filter(f => !allowedMembers.includes(f.userId))
    .map(f => f.id);

  if (unallowedAssigneeIds.length > 0) {
    await prisma.assignees.deleteMany({
      where: { id: { in: unallowedAssigneeIds } },
    });
  }

  if (unallowedFollowerIds.length > 0) {
    await prisma.follower.deleteMany({
      where: { id: { in: unallowedFollowerIds } },
    });
  }
}

async function cleanupTaskAndNestedSubtasks(task: any, newProjectId: number) {
  const allTaskIds = getAllTaskIdsRecursively(task);
  await Promise.all(
    allTaskIds.map((taskId) =>
      Promise.all([
        prisma.notification.deleteMany({
          where: {
            OR: [
              { comment: { taskId } },
              { taskId },
              { reaction: { taskId } },
              { assignee: { taskId } },
            ],
          },
        }),
        unAssignMembersNotInNewBoard(taskId, newProjectId),
        prisma.drafts.deleteMany({ where: { taskId } }),
        prisma.reminder.deleteMany({ where: { taskId } }),
        duplicateTags(taskId, newProjectId),
      ])
    )
  );
}

export interface MoveTaskToDifferentBoardParams {
  taskId: number;
  targetProjectId: number;
  targetSectionId: number;
  currentProjectId: number;
  currentUser: IUser;
  agentId?: string | null;
}

export interface MoveTaskToDifferentBoardResult {
  success: boolean;
  task?: any;
  error?: string;
  statusCode?: number;
}

/**
 * Moves a task to a section, including its nested subtasks when the board changes.
 *
 * 1. **Fetch task** – Load the task with all nested subtasks recursively.
 * 2. **Validate** – Return 404 if the task does not exist.
 * 3. **Load project & section** – Fetch target project, current project (for team check), and target section in parallel.
 * 4. **Validate targets** – Return 404 if target project or section is missing.
 * 5. **Same-board move** – Update only the main task's section and ranking, preserving its identity.
 * 6. **Cross-board placement** – Get a destination task index and ranking, then update the task's project and ticket identity.
 * 7. **Move subtasks** – Recursively move all nested subtasks (kept sequential to preserve unique indices).
 * 8. **Team switch** – If the target board is in a different team, reassign tasks whose assignees are not members.
 * 9. **Update & cleanup (parallel):**
 *    - Update estimates and priorities for the new project/section.
 *    - Refresh due-date queue entries for the new project.
 *    - Update saved content references to the new project.
 *    - Remove notifications, drafts, reminders; unassign users not in the new board; duplicate labels.
 * 10. **Return** – Return the updated main task on success.
 *
 * @param params - Task ID, target project/section, current project, and user.
 * @returns Success with the updated task, or an error with status code.
 */
export async function moveTaskToDifferentBoard(
  params: MoveTaskToDifferentBoardParams
): Promise<MoveTaskToDifferentBoardResult> {
  const {
    taskId,
    targetProjectId,
    targetSectionId,
    currentProjectId,
    currentUser,
    agentId,
  } = params;

  const taskToMove = await getTaskWithNestedSubtasks(taskId);
  if (!taskToMove) {
    return { success: false, error: "Task not found", statusCode: 404 };
  }

  const { newProject, currentProject, section } = await getProjectData(
    targetProjectId,
    currentProjectId,
    targetSectionId
  );

  if (!newProject) {
    return { success: false, error: "Target project not found", statusCode: 404 };
  }
  if (!section) {
    return { success: false, error: "Target section not found", statusCode: 404 };
  }
  // HTPR-4982: updateTaskSingle gates the board the task is leaving. Nothing
  // gated the board it lands on, so a member of one board could park a task on
  // any board whose id they guessed. The section has to belong to that board
  // too, or a stray id lands the task in a column of a third board.
  const canWriteTarget = await prisma.project.findFirst({
    where: {
      id: targetProjectId,
      ...taskWriteAccessWhere(currentUser.id, agentId),
    },
    select: { id: true },
  });
  if (!canWriteTarget || section.projectId !== targetProjectId) {
    return { success: false, error: "Target project not found", statusCode: 404 };
  }
  if (targetProjectId === taskToMove.projectId) {
    const ranking = await getNewTaskRanking(targetSectionId, targetProjectId);
    const result = await updateTaskSingle(
      {
        id: taskToMove.id,
        sectionId: targetSectionId,
        ranking,
        section: section.section_title ?? "",
        updatedAt: new Date(),
      },
      currentUser,
      agentId
    );
    if (result.status !== 200) {
      return {
        success: false,
        error: toErrorMessage(result.json, "Failed to update task"),
        statusCode: result.status ?? 500,
      };
    }
    return { success: true, task: result.json };
  }

  const projectIdentifier = newProject.uniqueIdentifier;
  if (!projectIdentifier) {
    return {
      success: false,
      error: "Target project has no ticket identifier",
      statusCode: 409,
    };
  }

  // Moving a sub-task on its own has to drop the parent link, or the child
  // would point at a task on another board. But when the parent has ALREADY
  // moved to the same board, dropping it orphans a family that is being moved
  // one member at a time, which is exactly how a whole tree gets moved by
  // hand (HTPR-4580). Keep the link in that case.
  const parentAlreadyInTarget = taskToMove.parentTaskId
    ? await prisma.task.findFirst({
        where: {
          id: taskToMove.parentTaskId,
          projectId: targetProjectId,
          status: { not: "Deleted" as const },
        },
        select: { id: true },
      })
    : null;

  const result = await moveTaskWithDestinationIdentity({
    taskId: taskToMove.id,
    projectId: targetProjectId,
    sectionId: targetSectionId,
    sectionTitle: section?.section_title ?? "",
    projectIdentifier,
    parentTaskId: parentAlreadyInTarget ? taskToMove.parentTaskId : null,
    currentUser,
    agentId,
  });
  if (result.status !== 200) {
    // Preserve the write's own status. Flattening every failure to 500 turned a
    // 409 lease conflict into a server error, so agent clients retried a
    // condition that only a lease claim resolves.
    return {
      success: false,
      error: toErrorMessage(result.json, "Failed to update task"),
      statusCode: result.status ?? 500,
    };
  }

  const updatedTask = result.json;

  if (taskToMove.subTasks?.length > 0) {
    await moveAllSubtasksRecursively(
      taskToMove.subTasks,
      targetProjectId,
      targetSectionId,
      projectIdentifier,
      updatedTask.id,
      currentUser,
      agentId
    );
  }

  const isTeamSwitch = currentProject?.teamId !== newProject?.teamId;
  if (isTeamSwitch) {
    await handleTeamSwitchForTaskRecursively(taskToMove, currentUser.id, newProject);
  }
  await Promise.all([
    updateTaskRelatedDataRecursively(taskToMove, targetProjectId, targetSectionId),
    updateDueDateQueueRecursively(taskToMove, currentProjectId, targetProjectId),
    updateAllSavedContentRecursively(taskToMove, targetProjectId, currentProjectId),
    cleanupTaskAndNestedSubtasks(taskToMove, targetProjectId),
  ]);

  for (const movedTaskId of getAllTaskIdsRecursively(taskToMove)) {
    const autoAssigned = await autoAssignForSection({
      taskId: movedTaskId,
      projectId: targetProjectId,
      sectionId: targetSectionId,
      currentUser,
      agentAssignerId: agentId,
    });
    if (autoAssigned !== "ready") {
      // Board moves do not create the task.created handoff marker. Keep the
      // move successful and let the next explicit assignment attempt retry.
      console.warn(
        "[task-move-board] column auto-assignment remains pending after the move",
        { taskId: movedTaskId },
      );
    }
  }

  return { success: true, task: updatedTask };
}
