import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskMoveTaskToInboxTool(context: ChatToolContext) {
  const { TOOL_TASK_ID_DESCRIPTION, ensureTaskMovedToInbox, findTaskByIdentifier, sanitizeForJson, sendStatus, tool, user, validateProjectMemberIds, withToolErrors, z } = context;
  return tool({
      description:
        "Route a task into a specific project member's inbox so they notice it.",
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
        user_id: z.coerce.number().int().positive(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_move_task_to_inbox");
        const identifierCount = [
          input.task_id !== undefined,
          input.ticket_number !== undefined,
          input.unique_index !== undefined,
        ].filter(Boolean).length;
        if (identifierCount === 0) {
          return {
            success: false,
            error:
              "Either task_id, ticket_number, or (project_id + unique_index) must be provided",
          };
        }
        if (identifierCount > 1) {
          return {
            success: false,
            error:
              "Cannot provide multiple task identification methods. Use one of: task_id, ticket_number, or (project_id + unique_index)",
          };
        }
        if (input.unique_index !== undefined && input.project_id === undefined) {
          return {
            success: false,
            error: "project_id is required when using unique_index",
          };
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

        const memberCheck = await validateProjectMemberIds(task.projectId, [
          input.user_id,
        ]);
        if (memberCheck.error) {
          return { success: false, error: memberCheck.error.message };
        }
        if (memberCheck.invalidIds.length > 0) {
          return {
            success: false,
            error: `User ${input.user_id} is not a member of this project and cannot receive the task in their inbox.`,
          };
        }

        await ensureTaskMovedToInbox(
          { userId: input.user_id, projectId: task.projectId, taskId: task.id },
          {
            taskId: task.id,
            userId: input.user_id,
            projectId: task.projectId,
            type: "TaskMovedToInbox",
            fromUserId: input.user_id,
          },
        );
        return sanitizeForJson({
          success: true,
          message: "Task moved to inbox",
          taskId: task.id,
          userId: input.user_id,
        });
      }),
    });
}
