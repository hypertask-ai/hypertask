import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskListLabelsTool(context: ChatToolContext) {
  const { labelStore, sanitizeForJson, sendStatus, tool, user, validateProjectAccess, withToolErrors, z } = context;
  return tool({
      description:
        "List labels available on one project/board. Use before assigning labels when you need valid label IDs.",
      inputSchema: z.object({
        project_id: z.coerce
          .number()
          .int()
          .positive()
          .describe(
            "Project/board id from Hypertask context or task results. Do not guess it from a ticket number."
          ),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_list_labels");
        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        const labels = await labelStore().findMany({
          where: { projectId: input.project_id },
          select: { id: true, value: true },
          orderBy: { value: "asc" },
        });

        return sanitizeForJson({
          success: true,
          projectId: input.project_id,
          labels: labels.map((label) => ({
            id: label.id,
            name: label.value || "",
          })),
        });
      }),
    });
}
