import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskGetTaskTreeTool(context: ChatToolContext) {
  const { TOOL_TASK_ID_DESCRIPTION, buildTaskTreeNode, findRootTaskIdForTree, resolveTaskForTool, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "Return the parent/subtask tree for a task, starting from its topmost ancestor.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().min(1).optional(),
        depth: z.coerce.number().int().min(0).optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_get_task_tree");
        const taskResult = await resolveTaskForTool(user, {
          task_id: input.task_id,
          ticket_number: input.ticket_number,
        });
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const anchor = taskResult.task;
        if (!anchor) {
          return { success: false, error: "Task not found or access denied" };
        }

        const rootResult = await findRootTaskIdForTree(anchor.id, user.id);
        if ("error" in rootResult) {
          return { success: false, error: rootResult.error };
        }

        const tree = await buildTaskTreeNode(
          rootResult.rootId,
          user.id,
          input.depth
        );

        return sanitizeForJson({
          success: true,
          tree,
        });
      }),
    });
}
