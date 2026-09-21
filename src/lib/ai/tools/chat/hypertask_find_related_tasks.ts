import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskFindRelatedTasksTool(context: ChatToolContext) {
  const { NextRequest, TOOL_TASK_ID_DESCRIPTION, handleRelatedTasksGet, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
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
    });
}
