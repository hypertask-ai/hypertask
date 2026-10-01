import { tool } from "ai";
import { z } from "zod";
import { startTimer, TimeTrackingDisabledError } from "@/lib/timeTracking";
import { TOOL_TASK_ID_DESCRIPTION } from "@/lib/ai/tools/constants";
import { withToolErrors, resolveTaskForTool } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createStartTimerTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_start_timer: tool({
      description:
        "Start a timer for a task. Provide whichever task identifier you know; extra identifiers are tolerated.",
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
        sendStatus("hypertask_start_timer");
        const taskResult = await resolveTaskForTool(user, input);
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        try {
          const entry = await startTimer(user.id, task.id);
          return sanitizeForJson({ success: true, entry });
        } catch (error) {
          if (error instanceof TimeTrackingDisabledError) {
            return { success: false, error: error.message };
          }
          throw error;
        }
      }),
    }),
  };
}
