import { tool } from "ai";
import { z } from "zod";
import { findTaskByIdentifier } from "@/lib/mcp/tasks/resolveTask";
import { setTaskWaitingOn } from "@/lib/tasks/setWaitingOn";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import { TOOL_TASK_ID_DESCRIPTION } from "@/lib/ai/tools/constants";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createClearTaskBlockerTool(context: ToolContext) {
  const { sendStatus, user, actingAgentId, teamScope } = context;
  return {
    hypertask_clear_task_blocker: tool({
      description:
        "Clear the red blocker border on a task, same as a person clearing it. Needs a short reason, which is written in a note that says who cleared it and why. The task then leaves the person's Decisions list. To undo, post the question again.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().trim().min(1).optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        reason: z.string().trim().min(1).max(500),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_clear_task_blocker");
        const identifierCount = [
          input.task_id !== undefined,
          input.ticket_number !== undefined,
          input.unique_index !== undefined,
        ].filter(Boolean).length;
        if (identifierCount !== 1) {
          return {
            success: false,
            error: "Provide exactly one of: task_id, ticket_number, or (project_id + unique_index)",
          };
        }
        if (input.unique_index !== undefined && input.project_id === undefined) {
          return { success: false, error: "project_id is required when using unique_index" };
        }

        const task = await findTaskByIdentifier(user, {
          task_id: input.task_id,
          ticket_number: input.ticket_number,
          unique_index: input.unique_index,
          project_id: input.project_id,
        });
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const result = await setTaskWaitingOn({
          taskId: task.id,
          blockerCommentId: null,
          reason: input.reason,
          currentUser: await loadSessionUserRecord(user.id),
          agentId: actingAgentId,
          teamScope,
        });
        if ("message" in result.body) {
          return { success: false, error: result.body.message };
        }
        return sanitizeForJson({ success: true, message: "Blocker cleared", taskId: task.id });
      }),
    }),
  };
}
