import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskTimeStatusTool(context: ChatToolContext) {
  const { TOOL_TASK_ID_DESCRIPTION, resolveTaskForTool, sanitizeForJson, sendStatus, taskSummary, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "Get the time-tracking status and totals for a task. Provide whichever task identifier you know; extra identifiers are tolerated.",
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
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_time_status");
        const taskResult = await resolveTaskForTool(user, input);
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const summary = await taskSummary(user.id, task.id);
        return sanitizeForJson({ success: true, summary });
      }),
    });
}
