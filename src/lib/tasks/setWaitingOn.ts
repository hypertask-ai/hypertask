import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { broadcastBoardChange, broadcastInboxChange, broadcastTaskChange } from "@/lib/realtime/server";
import { validateProjectMemberIds } from "@/lib/mcp/tasks/services";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import createActivity from "@/utils/controllers/activities/createActivity";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7724_BLOCKER_COMMENT_FLAG } from "@/lib/flags/definitions/htpr-7724-blocker-comment";
import type { AgentTokenTeamScope } from "@/lib/mcp/auth/types";

export async function setTaskWaitingOn({
  taskId,
  userId,
  blockerCommentId,
  currentUser,
  agentId,
  teamScope,
}: {
  taskId: number;
  userId?: number | null;
  blockerCommentId?: number | null;
  currentUser: { id: number };
  agentId?: string | null;
  teamScope?: AgentTokenTeamScope | null;
}) {
  if (blockerCommentId !== undefined && !(await isFeatureEnabled(HTPR_7724_BLOCKER_COMMENT_FLAG, currentUser.id))) {
    return { status: 404, body: { message: "Blocker comments are not enabled" } };
  }

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

  if (blockerCommentId != null && !await prisma.comment.findFirst({
    where: { id: blockerCommentId, taskId, activity: { equals: Prisma.DbNull } },
    select: { id: true },
  })) {
    return { status: 400, body: { message: "Blocker comment must be a comment on this task" } };
  }

  if (userId != null) {
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

  const waitingOnUser = userId == null
    ? null
    : await prisma.user.findUnique({
        where: { id: userId },
        select: { displayName: true },
      });

  const data: Prisma.TaskUncheckedUpdateInput = {};
  if (blockerCommentId !== undefined) data.blockerCommentId = blockerCommentId;
  if (userId !== undefined) {
    data.waitingOnUserId = userId;
    data.waitingOnSetById = userId === null ? null : currentUser.id;
    data.waitingOnSetAt = userId === null ? null : new Date();
  }

  const updatedTask = await prisma.task.update({
    where: { id: taskId },
    data,
    select: {
      id: true,
      ...(blockerCommentId !== undefined ? { blockerCommentId: true } : {}),
      waitingOnUserId: true,
      waitingOnSetById: true,
      waitingOnSetAt: true,
    },
  });

  if (userId !== undefined) await createActivity({
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
  if (blockerCommentId !== undefined) void broadcastTaskChange(taskId, { originUserId: currentUser.id });
  for (const affectedUserId of new Set(
    (userId === undefined ? [] : [task.waitingOnUserId, userId]).filter(
      (id): id is number => typeof id === "number"
    )
  )) {
    void broadcastInboxChange(affectedUserId, { originUserId: currentUser.id });
  }

  return { status: 200, body: updatedTask };
}
