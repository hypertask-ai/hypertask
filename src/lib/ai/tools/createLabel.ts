import { tool } from "ai";
import { z } from "zod";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createCreateLabelTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_create_label: tool({
      description:
        "Create a new label in a project/board.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
        name: z.string().min(1).max(100),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_create_label");
        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        const trimmedName = input.name.trim();
        if (!trimmedName) {
          return { success: false, error: "name must not be empty" };
        }

        const existing = await prisma.label.findFirst({
          where: {
            projectId: input.project_id,
            value: trimmedName,
          },
        });
        if (existing) {
          return {
            success: false,
            error: `Label "${trimmedName}" already exists in this project`,
          };
        }

        const label = await prisma.label.create({
          data: {
            value: trimmedName,
            projectId: input.project_id,
          },
        });

        void broadcastBoardChange(input.project_id, { originUserId: user.id });

        return sanitizeForJson({
          success: true,
          label: {
            id: label.id,
            name: label.value || trimmedName,
          },
          message: `Label "${trimmedName}" created successfully`,
        });
      }),
    }),
  };
}
