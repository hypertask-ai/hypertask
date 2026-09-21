import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskDeleteSkillTool(context: ChatToolContext) {
  const { bulkPreviewsIssued, confirmationSessionId, getAccessibleSkill, prisma, requireCrossMessageConfirmation, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
      description: "Delete an accessible personal or project skill by ID.",
      inputSchema: z.object({
        skill_id: z.coerce.number().int().positive(),
        confirmed: z
          .boolean()
          .optional()
          .describe(
            "Set true only after the user explicitly confirms deleting this shared project skill."
          ),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_delete_skill");
        const skill = await getAccessibleSkill(user.id, input.skill_id);
        if (skill.projectId !== null) {
          const operationKey = `delete-project-skill:${skill.id}`;
          if (
            await requireCrossMessageConfirmation({
              userId: user.id,
              sessionId: confirmationSessionId,
              operationKey,
              confirmed: input.confirmed,
              previewsIssuedThisRequest: bulkPreviewsIssued,
            }) === "preview"
          ) {
            return sanitizeForJson({
              success: false,
              confirmation_required: true,
              skill: {
                id: skill.id,
                name: skill.name,
                projectId: skill.projectId,
              },
              message:
                "This is a shared project skill. Nothing has been changed yet. Ask the user to confirm deleting it, then call this tool in a new message with confirmed: true.",
            });
          }
        }
        await prisma.aI_Skill.delete({ where: { id: skill.id } });
        return sanitizeForJson({ success: true });
      }),
    });
}
