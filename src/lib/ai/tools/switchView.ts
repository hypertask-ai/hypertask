import { tool } from "ai";
import { z } from "zod";
import { applyView } from "@/lib/mcp/views/services";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createSwitchViewTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_switch_view: tool({
      description:
        "Switch the user's active view on a board to the given view id (what the highlighted tab shows). Find the id with hypertask_list_views. Passing the board's default view id returns them to the default (all tasks) view.",
      inputSchema: z.object({
        view_id: z.string().min(1),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_switch_view");
        const result = await applyView({ viewId: input.view_id, userId: user.id });
        return sanitizeForJson({ success: true, ...result });
      }),
    }),
  };
}
