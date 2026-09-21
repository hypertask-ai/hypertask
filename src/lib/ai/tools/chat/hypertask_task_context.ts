import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";
import { Prisma } from "@prisma/client";

export function createHypertaskTaskContextTool(context: ChatToolContext) {
  const { HTPR_6516_AGENT_ATTRIBUTION_FLAG, TOOL_TASK_ID_DESCRIPTION, extractPrLinks, findTaskByIdentifier, getProjectWhere, isFeatureEnabled, mapTaskToMcpGetResponse, mapVisibleMcpAgent, mcpVisibleAgentSelect, prisma, resolvePublicAgentDisplayName, sanitizeForJson, sendStatus, stripInlineDataUris, taskMcpGetInclude, tool, user, withToolErrors, z } = context;
  return tool({
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
        const relatedTaskSelect = {
          id: true,
          ticketNumber: true,
          title: true,
          uniqueIndex: true,
        } satisfies Prisma.TaskSelect;

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
        const attributionEnabled = await isFeatureEnabled(
          HTPR_6516_AGENT_ATTRIBUTION_FLAG,
          user.id
        );
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
            attributionEnabled,
          });
          return {
            id: comment.id,
            author:
              agent?.displayName ||
              (comment.agent || comment.agentDisplayName ? "Private agent" : undefined) ||
              comment.creator?.displayName ||
              comment.creator?.email ||
              "Unknown",
            ...(attributionEnabled
              ? {
                  author:
                    agentDisplayName ||
                    comment.creator?.displayName ||
                    comment.creator?.email ||
                    "Unknown",
                }
              : {}),
            text: stripInlineDataUris(comment.text),
            createdAt: comment.createdAt.toISOString(),
          };
        });
        const relatedTasks = relations.map((relation) => {
          const outgoing = relation.sourceTaskId === resolvedTask.id;
          const relatedTask = outgoing
            ? relation.targetTask
            : relation.sourceTask;
          return {
            id: relatedTask.id,
            ticketNumber: relatedTask.ticketNumber || undefined,
            title: relatedTask.title,
            uniqueIndex: relatedTask.uniqueIndex,
            relationType: relation.relationType,
            direction: outgoing ? "outgoing" : "incoming",
          };
        });
        const linkedPRs = extractPrLinks(
          mappedTask.description,
          ...prComments.flatMap((comment) => [comment.text, comment.commentText])
        );

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
          linkedPRs,
          commentCount,
          truncated: commentCount > commentLimit,
        });
      }),
    });
}
