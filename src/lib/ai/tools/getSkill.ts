import { tool } from "ai";
import { z } from "zod";
import { getAccessibleSkill } from "@/app/api/ai/_lib/skillAccess";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createGetSkillTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_get_skill: tool({
      description:
        "Get one accessible personal or project skill by its positive integer ID.",
      inputSchema: z.object({
        skill_id: z.coerce.number().int().positive(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_get_skill");
        const skill = await getAccessibleSkill(user.id, input.skill_id);
        return sanitizeForJson({ success: true, skill });
      }),
    }),
  };
}
