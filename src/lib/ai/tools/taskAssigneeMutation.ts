import { type ToolTaskIdentifierInput, resolveUserIds } from "@/app/api/ai/chat/stream/bulkTools";
import { getProjectMembers } from "@/utils/controllers/projects/getProjectMembers";

import prisma from "@/lib/prisma";
import { buildMcpTaskUrl } from "@/lib/mcp/boards/links";
import assigneesAssign from "@/utils/controllers/assignees/assign";
import { isAgentOnBoard } from "@/utils/controllers/agents/boardMembers";
import { broadcastBoardChange } from "@/lib/realtime/server";

import { buildActivityUser } from "@/lib/ai/tools/helpers";
import { errorMessage } from "@/lib/ai/chatStream/errors";

import type { TaskAssigneeContext, TaskAssigneeTarget } from "./taskAssignees";

export function createSingleTaskAssigneeMutation(context: TaskAssigneeContext, input: ToolTaskIdentifierInput & { user_ids?: number[]; users?: (number | string)[] }, intent: "assign" | "unassign", activityUser: ReturnType<typeof buildActivityUser>, getMembers: (projectId: number) => ReturnType<typeof getProjectMembers>) {
  const { user, actingAgentId } = context;
  return async ({
    identifier,
    resolution: taskResult,
  }: TaskAssigneeTarget) => {
    if (taskResult.error || !taskResult.task) {
      return {
        success: false,
        error: taskResult.error ?? "Task not found or access denied",
      };
    }
    const task = await prisma.task.findUnique({
      where: { id: taskResult.task.id },
      select: { id: true, title: true, projectId: true, uniqueIndex: true },
    });
    if (!task) return { success: false, error: "Task not found" };

    const memberResult = await getMembers(task.projectId);
    if (memberResult.error) {
      return { success: false, error: memberResult.error.message };
    }
    const userResolution = resolveUserIds(
      input,
      user.id,
      memberResult.members
    );
    const taskFailures: {
      task_id: number;
      title: string;
      url: string;
      user?: number | string;
      agent?: string;
      error: string;
    }[] = userResolution.failures.map((failure) => ({
      task_id: task.id,
      title: task.title,
      url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
      ...failure,
    }));
    const currentAssignees = await prisma.assignees.findMany({
      where: { taskId: task.id },
      select: { userId: true, agentId: true },
    });
    const assignedUserIds = new Set(
      currentAssignees
        .filter((row) => row.agentId === null)
        .map((row) => row.userId)
    );
    const assignedAgentIds = new Set(
      currentAssignees
        .map((row) => row.agentId)
        .filter((agentId): agentId is string => agentId !== null)
    );
    const changedUserIds: number[] = [];
    const changedAgentIds: string[] = [];

    for (const userId of userResolution.userIds) {
      const wasAssigned = assignedUserIds.has(userId);
      let response: Awaited<ReturnType<typeof assigneesAssign>>;
      try {
        response = await assigneesAssign(
          activityUser,
          userId,
          task.id,
          undefined,
          actingAgentId ?? undefined,
          { intent }
        );
      } catch (error) {
        taskFailures.push({
          task_id: task.id,
          title: task.title,
          url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
          user: userId,
          error: errorMessage(error),
        });
        continue;
      }
      if (response.status !== 200) {
        taskFailures.push({
          task_id: task.id,
          title: task.title,
          url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
          user: userId,
          error:
            (response.json as { message?: string }).message ??
            `${intent === "assign" ? "Assign" : "Unassign"} failed`,
        });
        continue;
      }

      const responseRows = (
        response.json as { body?: { userId: number; agentId: string | null }[] }
      ).body;
      const nowAssigned = Array.isArray(responseRows)
        ? responseRows.some(
          (row) => row.userId === userId && row.agentId === null
        )
        : intent === "assign";
      if (
        (intent === "assign" && !wasAssigned && nowAssigned) ||
        (intent === "unassign" && wasAssigned && !nowAssigned)
      ) {
        changedUserIds.push(userId);
      }
      if (nowAssigned) assignedUserIds.add(userId);
      else assignedUserIds.delete(userId);
    }

    for (const agentId of userResolution.agentIds) {
      // Same rule the REST route enforces: you may only assign an agent you
      // own, not any agent that happens to share the board.
      const ownedAgent = await prisma.agent.findFirst({
        where: { id: agentId, userId: user.id },
        select: { id: true },
      });
      if (!ownedAgent) {
        taskFailures.push({
          task_id: task.id,
          title: task.title,
          url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
          agent: agentId,
          error: `Agent ${agentId} not found or not owned by you.`,
        });
        continue;
      }
      if (!(await isAgentOnBoard(task.projectId, agentId))) {
        taskFailures.push({
          task_id: task.id,
          title: task.title,
          url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
          agent: agentId,
          error: `Agent ${agentId} is not a member of this task's board.`,
        });
        continue;
      }

      const wasAssigned = assignedAgentIds.has(agentId);
      let response: Awaited<ReturnType<typeof assigneesAssign>>;
      try {
        const assignee = { agent_id: agentId };
        response = await assigneesAssign(
          activityUser,
          user.id,
          task.id,
          assignee.agent_id,
          actingAgentId ?? undefined,
          { intent }
        );
      } catch (error) {
        taskFailures.push({
          task_id: task.id,
          title: task.title,
          url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
          agent: agentId,
          error: errorMessage(error),
        });
        continue;
      }
      if (response.status !== 200) {
        taskFailures.push({
          task_id: task.id,
          title: task.title,
          url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
          agent: agentId,
          error:
            (response.json as { message?: string }).message ??
            `${intent === "assign" ? "Assign" : "Unassign"} failed`,
        });
        continue;
      }

      const responseRows = (
        response.json as { body?: { userId: number; agentId: string | null }[] }
      ).body;
      const nowAssigned = Array.isArray(responseRows)
        ? responseRows.some((row) => row.agentId === agentId)
        : intent === "assign";
      if (
        (intent === "assign" && !wasAssigned && nowAssigned) ||
        (intent === "unassign" && wasAssigned && !nowAssigned)
      ) {
        changedAgentIds.push(agentId);
      }
      if (nowAssigned) assignedAgentIds.add(agentId);
      else assignedAgentIds.delete(agentId);
    }

    void broadcastBoardChange(task.projectId, { originUserId: user.id });

    return {
      success: true,
      task: {
        task_id: task.id,
        title: task.title,
        url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
        assignees: [...assignedUserIds],
        agent_assignees: [...assignedAgentIds],
        changed: changedUserIds.length + changedAgentIds.length,
        changed_user_ids: changedUserIds,
        changed_agent_ids: changedAgentIds,
      },
      failures: taskFailures,
    };
  };
}
