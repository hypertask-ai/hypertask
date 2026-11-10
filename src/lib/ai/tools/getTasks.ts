import { tool } from "ai";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7756_CHAT_OPENS_TASK_FLAG } from "@/lib/flags/keys";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { blockedByRelationsInclude, getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  attachOpenBlockingTasks,
  type TaskWithBlockingRelations,
} from "@/utils/controllers/tasks/attachOpenBlockingTasks";
import { taskMcpGetInclude } from "@/lib/mcp/tasks/mappers";
import { sanitizeForJson, mapTaskToMcpGetResponse } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createGetTasksTool(context: ToolContext) {
  const { sendStatus, user, send } = context;
  return {
    hypertask_get_tasks: tool({
      description:
        "Get detailed fields for specific tasks by task IDs, ticket numbers, or project_id plus unique_index. For an explicit request to open a task (including a task from a previous list), set open=true with exactly one task. Only say the task was opened when navigation_emitted is true; otherwise say it could not be opened. Reading details alone does not open the task. Provide whichever identifiers you know; extra identifiers are tolerated and unioned.",
      inputSchema: z.object({
        open: z.boolean().optional(),
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
          include: {
            ...taskMcpGetInclude(user.id),
            relatedFromTasks: blockedByRelationsInclude(user.id),
          },
        });

        const tasksWithBlockers = await attachOpenBlockingTasks(
          tasks as Array<(typeof tasks)[number] & TaskWithBlockingRelations>,
        );

        const notFound = [
          ...(input.task_ids ?? [])
            .filter((taskId) => !tasksWithBlockers.some((task) => task.id === taskId))
            .map((task_id) => ({ task_id })),
          ...(input.ticket_numbers ?? [])
            .filter(
              (ticketNumber) =>
                !tasksWithBlockers.some((task) => task.ticketNumber === ticketNumber)
            )
            .map((ticket_number) => ({
              ticket_number,
              ...(input.project_id ? { project_id: input.project_id } : {}),
            })),
          ...(input.unique_index && input.project_id &&
            !tasksWithBlockers.some(
              (task) =>
                task.uniqueIndex === input.unique_index &&
                task.projectId === input.project_id
            )
            ? [{ unique_index: input.unique_index, project_id: input.project_id }]
            : []),
        ];

        if (tasksWithBlockers.length === 0) {
          return {
            success: false,
            error: "Task not found or access denied",
            tasks: [],
            not_found: notFound,
          };
        }

        let navigationEmitted: boolean | undefined;
        if (input.open) {
          if (!await isFeatureEnabled(HTPR_7756_CHAT_OPENS_TASK_FLAG, user.id)) {
            return { success: false, error: "Opening tasks from chat is unavailable", navigation_emitted: false };
          }
          if (tasksWithBlockers.length !== 1 || notFound.length > 0) {
            return { success: false, error: "Choose exactly one task to open", navigation_emitted: false };
          }
          try {
            navigationEmitted = send("open_task", { projectId: tasksWithBlockers[0].projectId, uniqueIndex: tasksWithBlockers[0].uniqueIndex }) === true;
          } catch {
            navigationEmitted = false;
          }
          if (!navigationEmitted) {
            return { success: false, error: "Could not open the task", navigation_emitted: false };
          }
        }

        return sanitizeForJson({
          success: true,
          ...(navigationEmitted === undefined ? {} : { navigation_emitted: navigationEmitted }),
          tasks: tasksWithBlockers.map((task) => mapTaskToMcpGetResponse(task, user.id)),
          not_found: notFound,
        });
      },
    }),
  };
}
