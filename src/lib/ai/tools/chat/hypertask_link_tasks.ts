import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskLinkTasksTool(context: ChatToolContext) {
  const { findTaskByIdentifier, normalizeTaskRelationType, prisma, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "Create or update a relation between two tasks. Identify each task with exactly one task ID or ticket number.",
      inputSchema: z.object({
        source_task_id: z.coerce.number().int().positive().optional(),
        source_ticket_number: z.string().trim().min(1).optional(),
        target_task_id: z.coerce.number().int().positive().optional(),
        target_ticket_number: z.string().trim().min(1).optional(),
        project_id: z.coerce.number().int().positive().optional(),
        relation_type: z
          .enum(["RelatedTo", "BlockedBy", "BlockedTo"])
          .nullish(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_link_tasks");
        const sourceCount = Number(input.source_task_id !== undefined) +
          Number(input.source_ticket_number !== undefined);
        const targetCount = Number(input.target_task_id !== undefined) +
          Number(input.target_ticket_number !== undefined);
        if (sourceCount !== 1) {
          return {
            success: false,
            error: "Provide exactly one of source_task_id or source_ticket_number",
          };
        }
        if (targetCount !== 1) {
          return {
            success: false,
            error: "Provide exactly one of target_task_id or target_ticket_number",
          };
        }

        const relationType = normalizeTaskRelationType(input.relation_type);
        if (!relationType) {
          return {
            success: false,
            error: "relation_type must be one of RelatedTo, BlockedBy, or BlockedTo",
          };
        }
        const [sourceTask, targetTask] = await Promise.all([
          findTaskByIdentifier(user, {
            task_id: input.source_task_id,
            ticket_number: input.source_ticket_number,
            project_id: input.project_id,
          }),
          findTaskByIdentifier(user, {
            task_id: input.target_task_id,
            ticket_number: input.target_ticket_number,
            project_id: input.project_id,
          }),
        ]);
        if (!sourceTask || !targetTask) {
          return { success: false, error: "Task not found or access denied" };
        }
        if (sourceTask.id === targetTask.id) {
          return { success: false, error: "A task cannot have a relation to itself" };
        }

        const relation = await prisma.taskRelations.upsert({
          where: {
            sourceTaskId_targetTaskId: {
              sourceTaskId: sourceTask.id,
              targetTaskId: targetTask.id,
            },
          },
          create: {
            sourceTaskId: sourceTask.id,
            targetTaskId: targetTask.id,
            relationType,
          },
          update: { relationType },
          select: {
            id: true,
            sourceTaskId: true,
            targetTaskId: true,
            relationType: true,
          },
        });
        return sanitizeForJson({ success: true, relation });
      }),
    });
}
