import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskResumeTimerTool(context: ChatToolContext) {
  const { TOOL_TASK_ID_DESCRIPTION, TimeTrackingDisabledError, resolveTaskForTool, resumeTimer, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "Resume the paused timer for a task. Provide whichever task identifier you know; extra identifiers are tolerated.",
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
        sendStatus("hypertask_resume_timer");
        const taskResult = await resolveTaskForTool(user, input);
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        try {
          const entry = await resumeTimer(user.id, task.id);
          if (!entry) {
            return {
              success: false,
              error: "There is no paused timer on that task.",
            };
          }
          return sanitizeForJson({ success: true, entry });
        } catch (error) {
          if (error instanceof TimeTrackingDisabledError) {
            return { success: false, error: error.message };
          }
          throw error;
        }
      }),
    });
}
