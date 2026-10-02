import { createSingleTaskAssigneeMutation } from "./taskAssigneeMutation";
import type { AuthedUser } from "@/lib/ai/chatStream/types";
import { type ToolTaskIdentifierInput, resolveBulkTaskTargets, resolveUserIds, buildBulkOperationKey } from "@/app/api/ai/chat/stream/bulkTools";
import { getProjectMembers } from "@/utils/controllers/projects/getProjectMembers";
import { requireCrossMessageConfirmation } from "@/lib/ai/bulkConfirmation";
import prisma from "@/lib/prisma";
import { buildMcpTaskUrl } from "@/lib/mcp/boards/links";

import { resolveTaskForTool } from "@/lib/ai/tools/execution";
import { sanitizeForJson, buildActivityUser } from "@/lib/ai/tools/helpers";
import { errorMessage } from "@/lib/ai/chatStream/errors";

export function createTaskAssigneeMutation(context: TaskAssigneeContext) {
  const { user, requestingUserId, confirmationSessionId, bulkPreviewsIssued } = context;
  const mutateTaskAssignees = async (
    input: ToolTaskIdentifierInput & {
      task_ids?: number[];
      ticket_numbers?: string[];
      user_ids?: number[];
      users?: (number | string)[];
      confirmed?: boolean;
    },
    intent: "assign" | "unassign"
  ) => {
    const targets = resolveBulkTaskTargets(input);
    if (!(input.user_ids?.length || input.users?.length)) {
      return {
        success: false,
        changed: 0,
        tasks: [],
        failures: [{ error: "Provide at least one person or agent in users or user_ids" }],
      };
    }

    const resolvedTargets = await Promise.all(
      targets.map(async (identifier) => ({
        identifier,
        resolution: await resolveTaskForTool(user, identifier),
      }))
    );
    const seenTaskIds = new Set<number>();
    const operationTargets = resolvedTargets.filter(({ resolution }) => {
      const taskId = resolution.task?.id;
      if (!taskId) return true;
      if (seenTaskIds.has(taskId)) return false;
      seenTaskIds.add(taskId);
      return true;
    });
    const projectMembers = new Map<
      number,
      ReturnType<typeof getProjectMembers>
    >();
    const getMembers = (projectId: number) => {
      const existing = projectMembers.get(projectId);
      if (existing) return existing;
      const pending = getProjectMembers(projectId, undefined, requestingUserId);
      projectMembers.set(projectId, pending);
      return pending;
    };

    if (targets.length >= 4) {
      const assigneeChanges = new Set<string>();
      const assigneeReferences = [
        ...(input.user_ids ?? []),
        ...(input.users ?? []),
      ];
      const projectIds = new Set(
        operationTargets.flatMap(({ resolution }) =>
          resolution.task ? [resolution.task.projectId] : []
        )
      );
      for (const projectId of projectIds) {
        const memberResult = await getMembers(projectId);
        if (memberResult.error) {
          for (const reference of assigneeReferences) {
            assigneeChanges.add(
              `unresolved-assignee:${projectId}:${JSON.stringify(reference)}`
            );
          }
          continue;
        }
        const userResolution = resolveUserIds(input, user.id, memberResult.members);
        for (const userId of userResolution.userIds) {
          assigneeChanges.add(`user:${userId}`);
        }
        for (const agentId of userResolution.agentIds) {
          assigneeChanges.add(`agent:${agentId}`);
        }
        for (const failure of userResolution.failures) {
          const reference =
            typeof failure.user === "string"
              ? failure.user.trim().toLowerCase()
              : failure.user;
          assigneeChanges.add(
            `unresolved-assignee:${projectId}:${JSON.stringify(reference)}`
          );
        }
      }
      if (projectIds.size === 0) {
        for (const reference of assigneeReferences) {
          const normalized =
            typeof reference === "string"
              ? reference.trim().toLowerCase()
              : reference;
          assigneeChanges.add(
            `unresolved-assignee:${JSON.stringify(normalized)}`
          );
        }
      }
      const operationKey = buildBulkOperationKey(
        `task-assignees:${intent}`,
        operationTargets.map(({ identifier, resolution }) => ({
          identifier,
          resolvedTaskId: resolution.task?.id ?? null,
        })),
        [...assigneeChanges]
      );
      if (
        await requireCrossMessageConfirmation({
          userId: user.id,
          sessionId: confirmationSessionId,
          operationKey,
          confirmed: input.confirmed,
          previewsIssuedThisRequest: bulkPreviewsIssued,
        }) === "preview"
      ) {
        const affected = await Promise.all(
          resolvedTargets.map(async ({ identifier, resolution }) => {
            if (!resolution.task) {
              return { ...identifier, error: resolution.error ?? "Not found" };
            }
            const details = await prisma.task.findUnique({
              where: { id: resolution.task.id },
              select: { id: true, title: true, projectId: true, uniqueIndex: true },
            });
            return details
              ? {
                task_id: details.id,
                title: details.title,
                url: buildMcpTaskUrl(details.projectId, details.uniqueIndex),
              }
              : { ...identifier, error: "Not found" };
          })
        );
        return sanitizeForJson({
          success: false,
          confirmation_required: true,
          affected,
          message:
            `This would ${intent} assignees ${intent === "assign" ? "to" : "from"} ${targets.length} tasks. Nothing has been changed yet. ` +
            "End your turn now: list the affected tasks for the user and ask them to confirm. Only after they say yes, in a new message, call this tool again with confirmed: true.",
        });
      }
    }

    const userObj = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, displayName: true, photoURL: true },
    });
    if (!userObj) {
      return {
        success: false,
        changed: 0,
        tasks: [],
        failures: [{ error: "User not found" }],
      };
    }
    const activityUser = buildActivityUser(userObj);

    const mutateOneTask = createSingleTaskAssigneeMutation(context, input, intent, activityUser, getMembers);

    const results = await Promise.all(
      operationTargets.map(async (target) => {
        try {
          return await mutateOneTask(target);
        } catch (error) {
          return { success: false, error: errorMessage(error) };
        }
      })
    );
    const tasks: {
      task_id: number;
      title: string;
      url: string;
      assignees: number[];
      changed: number;
      changed_user_ids: number[];
      agent_assignees: string[];
      changed_agent_ids: string[];
    }[] = [];
    const failures: Record<string, unknown>[] = [];
    results.forEach((result, index) => {
      if (result.success && "task" in result && result.task) {
        tasks.push(result.task);
        if ("failures" in result && Array.isArray(result.failures)) {
          failures.push(...result.failures);
        }
      } else {
        failures.push({
          ...operationTargets[index].identifier,
          error: "error" in result ? result.error : "Task assignment failed",
        });
      }
    });
    return sanitizeForJson({
      success: tasks.length > 0,
      changed: tasks.reduce((count, task) => count + task.changed, 0),
      tasks,
      failures,
    });
  };
  return mutateTaskAssignees;
}

export type TaskAssigneeContext = {
  user: AuthedUser;
  actingAgentId: string | null;
  requestingUserId: number;
  confirmationSessionId: string;
  bulkPreviewsIssued: Set<string>;
};
export type TaskAssigneeTarget = {
  identifier: ToolTaskIdentifierInput;
  resolution: Awaited<ReturnType<typeof resolveTaskForTool>>;
};
