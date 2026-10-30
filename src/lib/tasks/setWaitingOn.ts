import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { broadcastBoardChange, broadcastInboxChange, broadcastTaskChange } from "@/lib/realtime/server";
import { validateProjectMemberIds } from "@/lib/mcp/tasks/services";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import createActivity from "@/utils/controllers/activities/createActivity";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7724_BLOCKER_COMMENT_FLAG } from "@/lib/flags/definitions/htpr-7724-blocker-comment";
import { HTPR_8205_AGENT_CLEAR_BLOCKER_FLAG } from "@/lib/flags/definitions/htpr-8205-agent-clear-blocker";
import { actingAgentSelect } from "@/lib/agents/activityAttribution";
import type { AgentTokenTeamScope } from "@/lib/mcp/auth/types";

export async function setTaskWaitingOn({
  taskId,
  userId,
  blockerCommentId,
  reason,
  currentUser,
  agentId,
  teamScope,
}: {
  taskId: number;
  userId?: number | null;
  blockerCommentId?: number | null;
  reason?: string | null;
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
    select: { projectId: true, waitingOnUserId: true, blockerCommentId: true },
  });
  if (!task) {
    return { status: 404, body: { message: "Task not found" } };
  }

  const clearsBlocker = blockerCommentId === null && task.blockerCommentId !== null &&
    await isFeatureEnabled(HTPR_8205_AGENT_CLEAR_BLOCKER_FLAG, currentUser.id);
  const clearReason = reason?.trim() || null;
  if (clearsBlocker && agentId && !clearReason) {
    return { status: 400, body: { message: "Say why the blocker is cleared: reason is required when an agent clears it" } };
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

  const taskUpdate = {
    where: { id: taskId },
    data,
    select: {
      id: true,
      ...(blockerCommentId !== undefined ? { blockerCommentId: true } : {}),
      waitingOnUserId: true,
      waitingOnSetById: true,
      waitingOnSetAt: true,
    },
  } satisfies Prisma.TaskUpdateArgs;

  const actingAgent = clearsBlocker && agentId
    ? await prisma.agent.findUnique({ where: { id: agentId }, select: actingAgentSelect })
    : null;
  const activityBody = {
    type: "TaskWaitingOn",
    data: {
      fromUserId: currentUser.id,
      fromUser: currentUser,
      ...(actingAgent ? { fromAgent: actingAgent } : {}),
      waitingOnDisplayName: waitingOnUser?.displayName ?? null,
      ...(clearsBlocker ? { blockerCleared: true, reason: clearReason } : {}),
    },
  };

  let updatedTask;
  if (clearsBlocker) {
    updatedTask = await prisma.$transaction(async (tx) => {
      const updated = await tx.task.update(taskUpdate);
      await createActivity({ taskId, activityBody, transaction: tx });
      return updated;
    });
  } else {
    updatedTask = await prisma.task.update(taskUpdate);
    if (userId !== undefined) await createActivity({ taskId, activityBody });
  }

  void broadcastBoardChange(task.projectId, { originUserId: currentUser.id });
  if (blockerCommentId !== undefined) void broadcastTaskChange(taskId, { originUserId: currentUser.id });
  const mentionedUserIds = clearsBlocker
    ? (await prisma.notification.findMany({
        where: { taskId, type: "Mentioned" },
        select: { userId: true },
        distinct: ["userId"],
      })).map((row) => row.userId)
    : [];
  for (const affectedUserId of new Set([
    ...(userId === undefined ? [] : [task.waitingOnUserId, userId]).filter(
      (id): id is number => typeof id === "number"
    ),
    ...mentionedUserIds,
  ])) {
    void broadcastInboxChange(affectedUserId, { originUserId: currentUser.id });
  }

  return { status: 200, body: updatedTask };
}
