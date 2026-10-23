import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types';
import prisma from "@/lib/prisma";
import { Prisma, type Task } from "@prisma/client";
import getMemberAndOwner from "@/utils/controllers/getMemberAndOwnerForBoard";
import generateRank from "@/utils/generateRank";
import { getNextUniqueTaskIndex } from "./getNextUniqueTaskIndex";
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

import { upsertPageToTurbopuffer } from "../turbopuffer/turbopufferHelper";

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
  teamScope,
}: {
  taskId: number;
  projectId: number;
  sectionId: number;
  sectionTitle: string;
  projectIdentifier: string;
  parentTaskId: number | null;
  currentUser: IUser;
  agentId?: string | null;
  teamScope?: AgentTokenTeamScope | null;
}) {
  for (let attempt = 0; ; attempt++) {
    const [nextUniqueIndex, ranking] = await Promise.all([
      getNextUniqueTaskIndex(projectId),
      getNewTaskRanking(sectionId, projectId),
    ]);
    let movedPageIds: number[] = [];
    const result = await updateTaskSingle(
      {
        id: taskId,
        projectId,
        cycleId: null,
        sectionId,
        ranking,
        section: sectionTitle,
        uniqueIndex: nextUniqueIndex,
        ticketNumber: `${projectIdentifier}-${nextUniqueIndex}`,
        updatedAt: new Date(),
        parentTaskId,
      },
      currentUser,
      agentId,
      {
        allowProjectChange: true,
        teamScope,
        onProjectChangedInTx: async (tx, before, after) => {
          movedPageIds = await syncTaskPagesInTx(tx, before, after);
        },
        skipAutoAssign: true,
        skipRecurrence: true,
      },
    );
    if (result.status === 200) {
      await Promise.all(movedPageIds.map((id) => upsertPageToTurbopuffer(id).catch((error) => {
        console.error("Page indexing failed after task move", error);
      })));
    }
    if (
      result.status === 200 ||
      result.json?.code !== TASK_IDENTITY_CONFLICT_CODE ||
      attempt === TASK_IDENTITY_ALLOCATION_ATTEMPTS - 1
    ) {
      return result;
    }
  }
}

async function syncTaskPagesInTx(
  tx: Prisma.TransactionClient,
  before: Task,
  after: Task,
) {
  const affected = await tx.page.findMany({
    where: { OR: [{ taskId: after.id, links: { none: {} } }, { links: { some: { taskId: after.id, removedAt: null } } }] },
    select: { id: true, parentPageId: true },
  });
  if (affected.length === 0) return [];

  const pageIds = affected.map((page) => page.id);
  const lockIds = [...new Set([
    ...pageIds,
    ...affected.flatMap((page) => page.parentPageId == null ? [] : [page.parentPageId]),
  ])];
  await tx.$queryRaw`
    SELECT id FROM "Page"
    WHERE id IN (${Prisma.join(lockIds)})
      OR "parentPageId" IN (${Prisma.join(pageIds)})
    ORDER BY id
    FOR UPDATE
  `;
  const pages = await tx.page.findMany({
    where: { id: { in: pageIds } },
    include: { links: true },
  });
  for (const page of pages) {
    if (page.taskId != null && page.links.length === 0) {
      const link = await tx.pageTaskLink.upsert({
        where: { pageId_taskId: { pageId: page.id, taskId: page.taskId } },
        create: { pageId: page.id, taskId: page.taskId, createdAt: page.createdAt },
        update: {},
      });
      page.links.push(link);
    }
  }
  const movingIds = pages
    .filter((page) => {
      const activeLinks = page.links.filter((link) => link.removedAt === null);
      return page.projectId === before.projectId &&
        activeLinks.length === 1 && activeLinks[0].taskId === after.id;
    })
    .map((page) => page.id);
  if (movingIds.length === 0) return [];

  await tx.page.updateMany({
    where: { id: { in: movingIds } },
    data: { projectId: after.projectId },
  });
  return movingIds;
}

async function detachSplitPageHierarchy(taskIds: number[]) {
  await prisma.$transaction(async (tx) => {
    const affected = await tx.page.findMany({
      where: { OR: [{ taskId: { in: taskIds }, links: { none: {} } }, { links: { some: { taskId: { in: taskIds }, removedAt: null } } }] },
      select: { id: true, parentPageId: true },
    });
    if (affected.length === 0) return;
    const pageIds = affected.map((page) => page.id);
    const lockIds = [...new Set([
      ...pageIds,
      ...affected.flatMap((page) => page.parentPageId == null ? [] : [page.parentPageId]),
    ])];
    await tx.$queryRaw`
      SELECT id FROM "Page"
      WHERE id IN (${Prisma.join(lockIds)})
        OR "parentPageId" IN (${Prisma.join(pageIds)})
      ORDER BY id
      FOR UPDATE
    `;
    const pages = await tx.page.findMany({
      where: { OR: [{ id: { in: pageIds } }, { parentPageId: { in: pageIds } }] },
      include: { parentPage: { select: { projectId: true } } },
    });
    const splitIds = pages.filter((page) => page.parentPage && page.parentPage.projectId !== page.projectId)
      .map((page) => page.id);
    if (splitIds.length > 0) {
      await tx.page.updateMany({
        where: { id: { in: splitIds } },
        data: { parentPageId: null },
      });
    }
  });
}

async function moveAllSubtasksRecursively(
  subtasks: any[],
  projectId: number,
  sectionId: number,
  projectIdentifier: string,
  parentTaskId: number,
  currentUser: IUser,
  agentId?: string | null,
  teamScope?: AgentTokenTeamScope | null,
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
      teamScope,
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
        agentId,
        teamScope
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
  teamScope?: AgentTokenTeamScope | null;
}

export interface MoveTaskToDifferentBoardResult {
  success: boolean;
  task?: any;
  error?: string;
  statusCode?: number;
}

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
    teamScope,
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
  const canWriteTarget = await prisma.project.findFirst({
    where: {
      id: targetProjectId,
      ...taskWriteAccessWhere(currentUser.id, agentId, teamScope),
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
      agentId,
      { teamScope }
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
    teamScope,
  });
  if (result.status !== 200) {
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
      agentId,
      teamScope
    );
  }

  await detachSplitPageHierarchy(getAllTaskIdsRecursively(taskToMove));

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
      console.warn(
        "[task-move-board] column auto-assignment remains pending after the move",
        { taskId: movedTaskId },
      );
    }
  }

  return { success: true, task: updatedTask };
}
