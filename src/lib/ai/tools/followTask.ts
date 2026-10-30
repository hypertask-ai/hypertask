import { tool } from "ai";
import { z } from "zod";
import { TOOL_TASK_ID_DESCRIPTION } from "@/lib/ai/tools/constants";
import { withToolErrors, resolveTaskForTool } from "@/lib/ai/tools/execution";
import { setTaskTracking } from "@/lib/tasks/taskTracking";

import type { ToolContext } from "./context";

export function createFollowTaskTool(context: ToolContext) {
  const { sendStatus, user, actingAgentId, teamScope } = context;
  return {
    hypertask_follow_task: tool({
      description:
        "Follow, unfollow, star, unstar or set a reminder on a task, and read the tracking state back. follow keeps the task on the person's follower list, star is a private bookmark, and remind returns the task to the inbox at remind_at. Set remind_at as an ISO 8601 date time in the user's time zone. Use read to check the current state. Provide whichever task identifier you know.",
      inputSchema: z.object({
        action: z.enum(["follow", "unfollow", "star", "unstar", "remind", "read"]),
        task_id: z.coerce.number().int().positive().optional().describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        remind_at: z.string().optional().describe("ISO 8601 date time for the reminder; required by remind."),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_follow_task");
        const taskResult = await resolveTaskForTool(user, {
          task_id: input.task_id,
          ticket_number: input.ticket_number,
          unique_index: input.unique_index,
          project_id: input.project_id,
        });
        if (taskResult.error) return { success: false, error: taskResult.error };
        if (!taskResult.task) return { success: false, error: "Task not found or access denied" };
        if (input.action === "remind" && !input.remind_at) {
          return { success: false, error: "remind needs remind_at as an ISO 8601 date time." };
        }
        const result = await setTaskTracking({
          action: input.action,
          taskId: taskResult.task.id,
          remindAt: input.remind_at,
          currentUser: { id: user.id },
          agentId: actingAgentId,
          teamScope,
        });
        if ("message" in result.body) {
          return { success: false, error: String(result.body.message) };
        }
        return { success: true, ...result.body };
      }),
    }),
  };
}
