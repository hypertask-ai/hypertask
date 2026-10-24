import prisma from "@/lib/prisma";
import { broadcastBoardChange, broadcastInboxChange } from "@/lib/realtime/server";
import { validateProjectMemberIds } from "@/lib/mcp/tasks/services";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import createActivity from "@/utils/controllers/activities/createActivity";
import type { AgentTokenTeamScope } from "@/lib/mcp/auth/types";

export async function setTaskWaitingOn({
  taskId,
  userId,
  currentUser,
  agentId,
  teamScope,
}: {
  taskId: number;
  userId: number | null;
  currentUser: { id: number };
  agentId?: string | null;
  teamScope?: AgentTokenTeamScope | null;
}) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      status: { not: "Deleted" },
      project: agentId || teamScope
        ? { AND: [getProjectWhere(currentUser.id), getProjectWhere(currentUser.id, agentId, teamScope)] }
        : getProjectWhere(currentUser.id),
    },
    select: { projectId: true, waitingOnUserId: true },
  });
  if (!task) {
    return { status: 404, body: { message: "Task not found" } };
  }

  if (userId !== null) {
    const memberCheck = await validateProjectMemberIds(task.projectId, [userId]);
    if (memberCheck.error || memberCheck.invalidIds.length > 0) {
      return {
        status: memberCheck.error?.status ?? 400,
        body: {
          message:
            memberCheck.error?.message ??
            `User ${userId} is not a member of this project.`,
        },
      };
    }
  }

  const waitingOnUser = userId === null
    ? null
    : await prisma.user.findUnique({
        where: { id: userId },
        select: { displayName: true },
      });

  const updatedTask = await prisma.task.update({
    where: { id: taskId },
    data:
      userId === null
        ? {
            waitingOnUserId: null,
            waitingOnSetById: null,
            waitingOnSetAt: null,
          }
        : {
            waitingOnUserId: userId,
            waitingOnSetById: currentUser.id,
            waitingOnSetAt: new Date(),
          },
    select: {
      id: true,
      waitingOnUserId: true,
      waitingOnSetById: true,
      waitingOnSetAt: true,
    },
  });

  await createActivity({
    taskId,
    activityBody: {
      type: "TaskWaitingOn",
      data: {
        fromUserId: currentUser.id,
        fromUser: currentUser,
        waitingOnDisplayName: waitingOnUser?.displayName ?? null,
      },
    },
  });

  void broadcastBoardChange(task.projectId, { originUserId: currentUser.id });
  for (const affectedUserId of new Set(
    [task.waitingOnUserId, userId].filter(
      (id): id is number => typeof id === "number"
    )
  )) {
    void broadcastInboxChange(affectedUserId, { originUserId: currentUser.id });
  }

  return { status: 200, body: updatedTask };
}
