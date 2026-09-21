import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskMoveTaskBetweenBoardsTool(context: ChatToolContext) {
  const { TOOL_TASK_ID_DESCRIPTION, actingAgentId, broadcastBoardChange, buildActivityUser, buildMcpTaskUrl, getSectionForTask, mapTaskToDetail, moveTaskToDifferentBoard, prisma, resolveTaskForTool, sanitizeForJson, sendStatus, taskDetailInclude, tool, user, validateProjectAccess, withToolErrors, z } = context;
  return tool({
      description:
        "Move a task and its subtasks to a different project/board. Use hypertask_update_task for moving within the same board. Provide whichever task identifier you know; extra identifiers are tolerated.",
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
        target_project_id: z.coerce.number().int().positive(),
        target_section_id: z.coerce.number().int().positive().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_move_task_between_boards");
        const taskResult = await resolveTaskForTool(user, {
          task_id: input.task_id,
          ticket_number: input.ticket_number,
          unique_index: input.unique_index,
          project_id: input.project_id,
        });
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const targetAccess = await validateProjectAccess(
          input.target_project_id,
          user.id
        );
        if (targetAccess.error) {
          return { success: false, error: targetAccess.error.message };
        }

        const sectionResult = await getSectionForTask(
          input.target_project_id,
          input.target_section_id
        );
        if (sectionResult.error) {
          return { success: false, error: sectionResult.error.message };
        }

        const userObj = await prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, email: true, displayName: true, photoURL: true },
        });
        if (!userObj) return { success: false, error: "User not found" };
        const currentUser = buildActivityUser(userObj);

        const result = await moveTaskToDifferentBoard({
          taskId: task.id,
          targetProjectId: input.target_project_id,
          targetSectionId: sectionResult.section.id,
          currentProjectId: task.projectId,
          currentUser,
          agentId: actingAgentId,
        });

        if (!result.success) {
          return { success: false, error: result.error || "Failed to move task" };
        }

        void broadcastBoardChange(task.projectId, { originUserId: user.id });
        void broadcastBoardChange(input.target_project_id, { originUserId: user.id });

        const finalTask = await prisma.task.findUnique({
          where: { id: task.id },
          include: taskDetailInclude(user.id),
        });
        if (!finalTask && !result.task) {
          return { success: false, error: "Task moved but could not be retrieved" };
        }

        const mappedTask = finalTask
          ? mapTaskToDetail(finalTask, user.id)
          : mapTaskToDetail(result.task, user.id);

        return sanitizeForJson({
          success: true,
          task: mappedTask,
          url:
            mappedTask && "projectId" in mappedTask && "uniqueIndex" in mappedTask
              ? buildMcpTaskUrl(
                  Number(mappedTask.projectId),
                  Number(mappedTask.uniqueIndex)
                )
              : undefined,
          message: "Task moved successfully",
        });
      }),
    });
}
