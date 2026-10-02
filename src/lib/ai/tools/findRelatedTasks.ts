import { tool } from "ai";
import { z } from "zod";
import { handleRelatedTasksGet } from "@/lib/mcp/tasks/relatedTasks";
import { NextRequest } from "next/server";
import { TOOL_TASK_ID_DESCRIPTION } from "@/lib/ai/tools/constants";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createFindRelatedTasksTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_find_related_tasks: tool({
      description:
        "Find tasks similar to an existing accessible task across the user's boards.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        limit: z.coerce.number().int().positive().default(10),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_find_related_tasks");
        const response = await handleRelatedTasksGet(
          new NextRequest("http://localhost/api/mcp/tasks/related"),
          { user, agentId: null },
          { taskId: input.task_id, limit: input.limit }
        );
        const payload = (await response.json()) as Record<string, unknown>;
        return sanitizeForJson(payload);
      }),
    }),
  };
}
