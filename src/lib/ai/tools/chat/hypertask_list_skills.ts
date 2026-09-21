import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskListSkillsTool(context: ChatToolContext) {
  const { assertProjectAccess, prisma, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
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
    });
}
