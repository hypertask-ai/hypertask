import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";
import { Prisma } from "@prisma/client";

export function createHypertaskGetTasksTool(context: ChatToolContext) {
  const { getProjectWhere, mapTaskToMcpGetResponse, prisma, sanitizeForJson, sendStatus, taskMcpGetInclude, tool, user, z } = context;
  return tool({
      description:
        "Get detailed fields for specific tasks by task IDs, ticket numbers, or project_id plus unique_index. Use only for detail enrichment. Provide whichever identifiers you know; extra identifiers are tolerated and unioned.",
      inputSchema: z.object({
        task_ids: z.array(z.coerce.number().int().positive()).optional(),
        ticket_numbers: z.array(z.string()).optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
      }),
      execute: async (input) => {
        sendStatus("hypertask_get_tasks");
        if (input.unique_index && !input.project_id) {
          return { success: false, error: "project_id is required with unique_index" };
        }

        const orConditions: Prisma.TaskWhereInput[] = [];
        if (input.task_ids?.length) {
          orConditions.push({ id: { in: input.task_ids } });
        }
        if (input.ticket_numbers?.length) {
          orConditions.push({
            ticketNumber: { in: input.ticket_numbers },
            ...(input.project_id ? { projectId: input.project_id } : {}),
          });
        }
        if (input.unique_index && input.project_id) {
          orConditions.push({
            projectId: input.project_id,
            uniqueIndex: input.unique_index,
            status: { not: "Deleted" },
          });
        }
        if (orConditions.length === 0) {
          return {
            success: false,
            error:
              "Provide at least one of task_ids, ticket_numbers, or project_id + unique_index",
          };
        }

        const tasks = await prisma.task.findMany({
          where: {
            OR: orConditions,
            project: getProjectWhere(user.id),
          },
          include: taskMcpGetInclude(user.id),
        });

        const notFound = [
          ...(input.task_ids ?? [])
            .filter((taskId) => !tasks.some((task) => task.id === taskId))
            .map((task_id) => ({ task_id })),
          ...(input.ticket_numbers ?? [])
            .filter(
              (ticketNumber) =>
                !tasks.some((task) => task.ticketNumber === ticketNumber)
            )
            .map((ticket_number) => ({
              ticket_number,
              ...(input.project_id ? { project_id: input.project_id } : {}),
            })),
          ...(input.unique_index && input.project_id &&
          !tasks.some(
            (task) =>
              task.uniqueIndex === input.unique_index &&
              task.projectId === input.project_id
          )
            ? [{ unique_index: input.unique_index, project_id: input.project_id }]
            : []),
        ];

        if (tasks.length === 0) {
          return {
            success: false,
            error: "Task not found or access denied",
            tasks: [],
            not_found: notFound,
          };
        }

        return sanitizeForJson({
          success: true,
          tasks: tasks.map((task) => mapTaskToMcpGetResponse(task, user.id)),
          not_found: notFound,
        });
      },
    });
}
