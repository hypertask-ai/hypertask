import { tool } from "ai";
import { z } from "zod";
import { assertProjectAccess } from "@/app/api/ai/_lib/customInstructions";
import prisma from "@/lib/prisma";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createListSkillsTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_list_skills: tool({
      description:
        "List personal skills, plus project skills when project_id is provided.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_list_skills");
        if (input.project_id) {
          await assertProjectAccess(user.id, input.project_id);
        }
        const skills = await prisma.aI_Skill.findMany({
          where: {
            OR: [
              { userId: user.id, projectId: null },
              ...(input.project_id
                ? [{ projectId: input.project_id, userId: null }]
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
