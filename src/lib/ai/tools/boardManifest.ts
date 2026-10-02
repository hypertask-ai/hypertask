import { tool } from "ai";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { columnRoleFor } from "@/lib/mcp/boards/columnRole";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createBoardManifestTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_board_manifest: tool({
      description:
        "Get a board's ordered columns, semantic column roles, and transition policy.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_board_manifest");
        const project = await prisma.project.findFirst({
          where: {
            id: input.project_id,
            status: "Normal",
            ...getProjectWhere(user.id),
          },
          select: {
            id: true,
            title: true,
            section: {
              where: { deleted: false, visibility: true },
              select: {
                id: true,
                section_title: true,
                isDone: true,
                ranking: true,
              },
              orderBy: { ranking: "asc" },
            },
          },
        });
        if (!project) {
          return { success: false, error: "Project not found or access denied" };
        }

        return sanitizeForJson({
          success: true,
          projectId: project.id,
          boardTitle: project.title || "",
          columns: project.section.map((section) => ({
            id: section.id,
            title: section.section_title,
            position: section.ranking,
            role: columnRoleFor(section),
            wipLimit: null,
          })),
          transitions: "any",
        });
      }),
    }),
  };
}
