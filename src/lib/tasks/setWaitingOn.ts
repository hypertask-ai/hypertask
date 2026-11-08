import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { broadcastBoardChange, broadcastInboxChange, broadcastTaskChange } from "@/lib/realtime/server";
import { validateProjectMemberIds } from "@/lib/mcp/tasks/services";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import createActivity from "@/utils/controllers/activities/createActivity";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7724_BLOCKER_COMMENT_FLAG } from "@/lib/flags/definitions/htpr-7724-blocker-comment";
import { HTPR_8205_AGENT_CLEAR_BLOCKER_FLAG } from "@/lib/flags/definitions/htpr-8205-agent-clear-blocker";
import { HTPR_8917_AGENT_WAITING_PERSON_FLAG } from "@/lib/flags/definitions/htpr-8917-agent-waiting-person";
import { actingAgentSelect } from "@/lib/agents/activityAttribution";
import { mapVisibleMcpAgent } from "@/lib/mcp/agents";
import { boardAgentVisibilityWhere } from "@/lib/agents/visibility";
import type { AgentTokenTeamScope } from "@/lib/mcp/auth/types";

const AGENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function setTaskWaitingOn({
  taskId,
  userId,
  waitingAgentId,
  blockerCommentId,
  reason,
  currentUser,
  agentId,
  teamScope,
}: {
  taskId: number;
  userId?: number | null;
  waitingAgentId?: string | null;
  blockerCommentId?: number | null;
  reason?: string | null;
  currentUser: { id: number };
  agentId?: string | null;
  teamScope?: AgentTokenTeamScope | null;
}) {
  if (waitingAgentId !== undefined && !(await isFeatureEnabled(HTPR_8917_AGENT_WAITING_PERSON_FLAG, currentUser.id))) {
    return { status: 404, body: { message: "Agent waiting person is not enabled" } };
  }
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
    select: { projectId: true, waitingOnUserId: true, waitingOnAgentId: true, blockerCommentId: true },
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

  if (typeof waitingAgentId === "string" && userId != null) {
    return { status: 400, body: { message: "Provide a person or an agent, not both" } };
  }

  let waitingAgent: { id: string; displayName: string | null; userId: number } | null = null;
  if (typeof waitingAgentId === "string") {
    if (!AGENT_UUID.test(waitingAgentId)) {
      return { status: 400, body: { message: "Agent id must be a UUID" } };
    }
    waitingAgent = await prisma.agent.findFirst({
      where: {
        id: waitingAgentId,
        revokedAt: null,
        archivedAt: null,
        ...boardAgentVisibilityWhere(currentUser.id),
        members: { some: { projectId: task.projectId, status: "Accepted" } },
      },
      select: {
        id: true,
        displayName: true,
        userId: true,
        visibility: true,
        members: { where: { projectId: task.projectId }, select: { projectId: true } },
      },
    });
    if (!waitingAgent) {
      return { status: 400, body: { message: "Agent is not a member of this project." } };
    }
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
    data.waitingOnAgentId = null;
  }
  if (waitingAgentId !== undefined) {
    data.waitingOnAgentId = waitingAgentId;
    if (waitingAgentId !== null) {
      data.waitingOnUserId = null;
      data.waitingOnSetById = currentUser.id;
      data.waitingOnSetAt = new Date();
    } else if (userId === undefined && task.waitingOnUserId == null) {
      data.waitingOnSetById = null;
      data.waitingOnSetAt = null;
    }
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
      ...(data.waitingOnAgentId !== undefined ? { waitingOnAgentId: true } : {}),
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
      waitingOnDisplayName: (waitingAgent
        ? mapVisibleMcpAgent(waitingAgent, currentUser.id, task.projectId)?.displayName
        : waitingOnUser?.displayName) ?? null,
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
    if (userId !== undefined || waitingAgentId !== undefined) await createActivity({ taskId, activityBody });
  }

  void broadcastBoardChange(task.projectId, { originUserId: currentUser.id });
  if (blockerCommentId !== undefined) void broadcastTaskChange(taskId, { originUserId: currentUser.id });
  const nextAgentId = Object.prototype.hasOwnProperty.call(data, "waitingOnAgentId")
    ? data.waitingOnAgentId
    : task.waitingOnAgentId;
  const previousAgentUserId = task.waitingOnAgentId && task.waitingOnAgentId !== nextAgentId
    ? (await prisma.agent.findUnique({ where: { id: task.waitingOnAgentId }, select: { userId: true } }))?.userId
    : undefined;
  const mentionedUserIds = clearsBlocker
    ? (await prisma.notification.findMany({
        where: { taskId, type: "Mentioned" },
        select: { userId: true },
        distinct: ["userId"],
      })).map((row) => row.userId)
    : [];
  for (const affectedUserId of new Set([
    ...(userId === undefined && waitingAgentId === undefined ? [] : [task.waitingOnUserId, userId, waitingAgent?.userId, previousAgentUserId]).filter(
      (id): id is number => typeof id === "number"
    ),
    ...mentionedUserIds,
  ])) {
    void broadcastInboxChange(affectedUserId, { originUserId: currentUser.id });
  }

  return { status: 200, body: updatedTask };
}
