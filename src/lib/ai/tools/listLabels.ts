import { tool } from "ai";
import { z } from "zod";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import prisma from "@/lib/prisma";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createListLabelsTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_list_labels: tool({
      description:
        "List labels available on one project/board. Use before assigning labels when you need valid label IDs.",
      inputSchema: z.object({
        project_id: z.coerce
          .number()
          .int()
          .positive()
          .describe(
            "Project/board id from Hypertask context or task results. Do not guess it from a ticket number."
          ),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_list_labels");
        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        const labels = await prisma.label.findMany({
          where: { projectId: input.project_id },
          select: { id: true, value: true },
          orderBy: { value: "asc" },
        });

        return sanitizeForJson({
          success: true,
          projectId: input.project_id,
          labels: labels.map((label) => ({
            id: label.id,
            name: label.value || "",
          })),
        });
      }),
    }),
  };
}
