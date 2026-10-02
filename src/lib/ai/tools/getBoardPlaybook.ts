import { tool } from "ai";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createGetBoardPlaybookTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_get_board_playbook: tool({
      description:
        "Get a board's working rules and definition of done, or null when none is set.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_get_board_playbook");
        const project = await prisma.project.findFirst({
          where: {
            id: input.project_id,
            status: "Normal",
            ...getProjectWhere(user.id),
          },
          select: { id: true, playbook: true },
        });
        if (!project) {
          return { success: false, error: "Project not found or access denied" };
        }

        return sanitizeForJson({
          success: true,
          projectId: project.id,
          playbook: project.playbook ?? null,
        });
      }),
    }),
  };
}
