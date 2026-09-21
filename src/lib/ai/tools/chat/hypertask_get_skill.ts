import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskGetSkillTool(context: ChatToolContext) {
  const { getAccessibleSkill, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
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
    });
}
