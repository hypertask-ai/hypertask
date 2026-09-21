import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";
import { Prisma } from "@prisma/client";

export function createHypertaskGetCommentsForTaskTool(context: ChatToolContext) {
  const { HTPR_6516_AGENT_ATTRIBUTION_FLAG, TOOL_TASK_ID_DESCRIPTION, applyDurableCommentAttribution, commentInclude, isFeatureEnabled, mapCommentToResponse, prisma, resolveTaskForTool, sanitizeForJson, sendStatus, sortOrderSchema, tool, user, withActivityMetadata, z } = context;
  return tool({
      description:
        "Get user comments for a specific task. Use only when the user explicitly asks for comments on a task. Provide whichever task identifier you know; extra identifiers are tolerated. Set include_activity=true to also return the task's history: label, move, assignment and priority changes, each tagged type='activity'.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        include_activity: z
          .boolean()
          .default(false)
          .describe(
            "Include the task's history rows (label, move, assignment and priority changes) alongside user comments."
          ),
        sort_order: sortOrderSchema.default("desc"),
      }),
      execute: async (input) => {
        sendStatus("hypertask_get_comments_for_task");
        const taskResult = await resolveTaskForTool(user, {
          task_id: input.task_id,
          ticket_number: input.ticket_number,
          unique_index: input.unique_index,
          project_id: input.project_id,
        });
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const commentWhere: Prisma.CommentWhereInput = input.include_activity
          ? { taskId: task.id }
          : { taskId: task.id, activity: { equals: Prisma.DbNull } };
        const [total, comments] = await Promise.all([
          prisma.comment.count({ where: commentWhere }),
          prisma.comment.findMany({
            where: commentWhere,
            include: commentInclude(user.id, task.projectId),
            orderBy: { createdAt: input.sort_order },
            take: input.limit,
            skip: input.offset,
          }),
        ]);

        const attributionEnabled = await isFeatureEnabled(
          HTPR_6516_AGENT_ATTRIBUTION_FLAG,
          user.id
        );
        const commentsPayload = {
          success: true,
          comments: comments.map((comment) =>
            input.include_activity
              ? withActivityMetadata(
                  mapCommentToResponse(comment, user.id, task.projectId),
                  comment.activity
                )
              : mapCommentToResponse(comment, user.id, task.projectId)
          ),
          total,
          limit: input.limit,
          offset: input.offset,
        };
        commentsPayload.comments = commentsPayload.comments.map((mapped, index) =>
          applyDurableCommentAttribution(
            mapped,
            comments[index],
            user.id,
            task.projectId,
            attributionEnabled
          )
        );
        return sanitizeForJson(commentsPayload);
      },
    });
}
