import { tool } from "ai";
import { z } from "zod";
import { assertProjectAccess } from "@/app/api/ai/_lib/customInstructions";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createListSkillsTool(context: ToolContext) {
  const { sendStatus, user, actingAgentId, teamScope } = context;
  return {
    hypertask_list_skills: tool({
      description:
        "List skills available in your scope, optionally for a specific project.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_list_skills");
        if (input.project_id) {
          await assertProjectAccess(user.id, input.project_id, actingAgentId, teamScope);
        }
        const skills = await prisma.aI_Skill.findMany({
          where: {
            OR: [
              ...(teamScope != null ? [] : [{ userId: user.id, projectId: null }]),
              ...(input.project_id || teamScope != null
                ? [{
                    ...(input.project_id ? { projectId: input.project_id } : {}),
                    userId: null,
                    project: { is: getProjectWhere(user.id, actingAgentId, teamScope) },
                  }]
                : []),
            ],
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
        });
        return sanitizeForJson({
          success: true,
          skills,
          total: skills.length,
        });
      }),
    }),
  };
}
