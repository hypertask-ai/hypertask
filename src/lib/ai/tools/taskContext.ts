import { tool } from "ai";
import { z } from "zod";
import { findTaskByIdentifier } from "@/lib/mcp/tasks/resolveTask";
import { Prisma } from "@prisma/client";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_8896_SKIP_TAKEN_WORK_FLAG } from "@/lib/flags/definitions/htpr-8896-skip-taken-work";
import { loadTaskAgentActivities, mapRelatedTaskContext, relatedTaskContextSelect } from "@/lib/mcp/tasks/relatedTaskContext";
import { taskMcpGetInclude } from "@/lib/mcp/tasks/mappers";
import { mcpVisibleAgentSelect, mapVisibleMcpAgent } from "@/lib/mcp/agents";
import { resolvePublicAgentDisplayName } from "@/lib/agents/publicAgent";
import { extractPrLinks } from "@/lib/mcp/tasks/extractPrLinks";
import { TOOL_TASK_ID_DESCRIPTION } from "@/lib/ai/tools/constants";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { mapTaskToMcpGetResponse, stripInlineDataUris, sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createTaskContextTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_task_context: tool({
      description:
        "Get a focused context pack for one task, including its parent, subtasks, relations, recent comments, and linked pull requests.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        project_id: z.coerce.number().int().positive(),
        summary: z.boolean().default(false),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_task_context");
        const resolvedTask = await findTaskByIdentifier(user, {
          task_id: input.task_id,
        });
        if (!resolvedTask || resolvedTask.projectId !== input.project_id) {
          return { success: false, error: "Task not found or access denied" };
        }

        const commentLimit = input.summary ? 3 : 20;
        const commentWhere = {
          taskId: resolvedTask.id,
          activity: { equals: Prisma.DbNull },
        } satisfies Prisma.CommentWhereInput;
        const relatedTaskAccess = {
          status: { not: "Deleted" },
          project: getProjectWhere(user.id),
        } satisfies Prisma.TaskWhereInput;
        const relatedTaskSelect = relatedTaskContextSelect(user.id);

        const [task, commentCount, recentComments, prComments, relations] =
          await Promise.all([
            prisma.task.findFirst({
              where: {
                id: resolvedTask.id,
                projectId: input.project_id,
                status: { not: "Deleted" },
              },
              include: taskMcpGetInclude(user.id),
            }),
            prisma.comment.count({ where: commentWhere }),
            prisma.comment.findMany({
              where: commentWhere,
              select: {
                id: true,
                text: true,
                createdAt: true,
                agentDisplayName: true,
                creator: {
                  select: { email: true, displayName: true },
                },
                agent: {
                  select: mcpVisibleAgentSelect(user.id, input.project_id),
                },
              },
              orderBy: { createdAt: "desc" },
              take: commentLimit,
            }),
            prisma.comment.findMany({
              where: commentWhere,
              select: { text: true, commentText: true },
              orderBy: { createdAt: "asc" },
              take: 200,
            }),
            prisma.taskRelations.findMany({
              where: {
                OR: [
                  {
                    sourceTaskId: resolvedTask.id,
                    targetTask: relatedTaskAccess,
                  },
                  {
                    targetTaskId: resolvedTask.id,
                    sourceTask: relatedTaskAccess,
                  },
                ],
              },
              select: {
                sourceTaskId: true,
                targetTaskId: true,
                relationType: true,
                sourceTask: { select: relatedTaskSelect },
                targetTask: { select: relatedTaskSelect },
              },
              orderBy: { createdAt: "asc" },
            }),
          ]);

        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const mappedTask = mapTaskToMcpGetResponse(task, user.id);
        const comments = recentComments.reverse().map((comment) => {
          const agent = mapVisibleMcpAgent(
            comment.agent,
            user.id,
            input.project_id
          );
          const agentDisplayName = resolvePublicAgentDisplayName({
            hasAgentRow: Boolean(comment.agent),
            visibleAgent: agent,
            storedDisplayName: comment.agentDisplayName,
          });
          return {
            id: comment.id,
            author:
              agentDisplayName ||
              comment.creator?.displayName ||
              comment.creator?.email ||
              "Unknown",
            text: stripInlineDataUris(comment.text),
            createdAt: comment.createdAt.toISOString(),
          };
        });
        const relatedTasks = await Promise.all(relations.map(async (relation) => {
          const outgoing = relation.sourceTaskId === resolvedTask.id;
          const relatedTask = outgoing
            ? relation.targetTask
            : relation.sourceTask;
          const related = await mapRelatedTaskContext(relatedTask, user.id, relatedTaskAccess);
          return {
            ...related,
            agentActivities: related.agentActivities.map((activity) => ({
              ...activity,
              text: stripInlineDataUris(activity.text),
            })),
            relationType: relation.relationType,
            direction: outgoing ? "outgoing" : "incoming",
          };
        }));
        const linkedPRs = extractPrLinks(
          mappedTask.description,
          ...prComments.flatMap((comment) => [comment.text, comment.commentText])
        );
        const showActiveLog = await isFeatureEnabled(
          HTPR_8896_SKIP_TAKEN_WORK_FLAG,
          user.id,
        );
        const agentActivities = showActiveLog
          ? (await loadTaskAgentActivities(
              { id: resolvedTask.id, projectId: input.project_id },
              user.id,
              relatedTaskAccess,
              true,
            )).map((activity) => ({
              ...activity,
              text: stripInlineDataUris(activity.text),
            }))
          : undefined;

        return sanitizeForJson({
          success: true,
          task: {
            id: mappedTask.id,
            ticketNumber: mappedTask.ticketNumber,
            title: mappedTask.title,
            description: mappedTask.description,
            section: mappedTask.section,
            labels: mappedTask.labels,
            assignees: mappedTask.assignees,
            priority: mappedTask.priority,
            dueDate: mappedTask.dueDate,
          },
          parent: mappedTask.parent_task ?? null,
          subtasks: mappedTask.sub_tasks,
          relatedTasks,
          comments,
          ...(agentActivities ? { agentActivities } : {}),
          linkedPRs,
          commentCount,
          truncated: commentCount > commentLimit,
        });
      }),
    }),
  };
}
