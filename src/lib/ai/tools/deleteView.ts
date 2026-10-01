import { tool } from "ai";
import { z } from "zod";
import { deleteView } from "@/lib/mcp/views/services";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createDeleteViewTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_delete_view: tool({
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
    }),
  };
}
