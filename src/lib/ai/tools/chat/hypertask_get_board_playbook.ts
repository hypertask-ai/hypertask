import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskGetBoardPlaybookTool(context: ChatToolContext) {
  const { getProjectWhere, prisma, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
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
    });
}
