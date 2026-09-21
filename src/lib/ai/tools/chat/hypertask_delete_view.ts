import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskDeleteViewTool(context: ChatToolContext) {
  const { deleteView, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "Delete a saved board view by id. Find the id with hypertask_list_views first. Cannot delete a board's default view or someone else's private view.",
      inputSchema: z.object({
        view_id: z.string().min(1),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_delete_view");
        const deleted = await deleteView(input.view_id, user.id);
        return sanitizeForJson({ success: true, view: deleted });
      }),
    });
}
