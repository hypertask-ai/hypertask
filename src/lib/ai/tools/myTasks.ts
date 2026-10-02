import { tool } from "ai";
import { z } from "zod";
import { MY_TASKS_MAX_LIMIT, MY_TASKS_DEFAULT_LIMIT, getMyTasksSummary } from "@/lib/mcp/tasks/myTasksSummary";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createMyTasksTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_my_tasks: tool({
      description:
        "The user's own workload across EVERY board they can see, grouped per board, the same set the My Tasks page shows. Use this for \"what am I working on\", \"what's overdue\", \"how many tasks do I have\", \"what do I have on board X\", and as the first step before unassigning the user from a board's tasks. Counts (total, overdue_total, each board's total) are always exact even when the task rows are capped, so report those numbers rather than counting the rows.",
      inputSchema: z.object({
        project_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe("Narrow to one board. Omit for every board."),
        overdue_only: z.boolean().default(false),
        include_tasks: z
          .boolean()
          .default(true)
          .describe("Set false for a counts-only breakdown per board."),
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(MY_TASKS_MAX_LIMIT)
          .default(MY_TASKS_DEFAULT_LIMIT),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_my_tasks");
        return sanitizeForJson(
          await getMyTasksSummary({
            userId: user.id,
            projectId: input.project_id ?? null,
            overdueOnly: input.overdue_only,
            includeTasks: input.include_tasks,
            limit: input.limit,
          })
        );
      }),
    }),
  };
}
