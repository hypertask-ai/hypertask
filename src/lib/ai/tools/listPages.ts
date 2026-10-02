import { tool } from "ai";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import { listPages } from "@/utils/controllers/pages/pageService";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createListPagesTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_list_pages: tool({
      description:
        "List the non-archived Hypertask pages attached to a task or belonging to a project. Provide task_id, project_id, or both.",
      inputSchema: z.object({
        task_id: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_list_pages");
        if (!input.task_id && !input.project_id) {
          return {
            success: false,
            error: "Either task_id or project_id is required",
          };
        }

        if (input.task_id) {
          const task = await prisma.task.findUnique({
            where: { id: input.task_id },
            select: { projectId: true },
          });
          if (!task) {
            return { success: false, error: "Task not found" };
          }

          const access = await validateProjectAccess(task.projectId, user.id);
          if (access.error) {
            return { success: false, error: access.error.message };
          }
        }

        if (input.project_id) {
          const access = await validateProjectAccess(input.project_id, user.id);
          if (access.error) {
            return { success: false, error: access.error.message };
          }
        }

        const pages = await listPages({
          taskId: input.task_id,
          projectId: input.project_id,
        });
        return sanitizeForJson({ success: true, pages });
      }),
    }),
  };
}
