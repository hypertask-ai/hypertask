import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskCreateLabelTool(context: ChatToolContext) {
  const { broadcastBoardChange, labelStore, sanitizeForJson, sendStatus, tool, user, validateProjectAccess, withToolErrors, z } = context;
  return tool({
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

        const existing = await labelStore().findFirst({
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

        const label = await labelStore().create({
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
    });
}
