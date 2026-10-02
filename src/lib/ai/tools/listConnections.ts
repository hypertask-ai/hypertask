import { tool } from "ai";
import { z } from "zod";
import { listOwnedConnections } from "@/lib/mcp/connections";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createListConnectionsTool(context: ToolContext) {
  const { sendStatus, actingAgentId, user } = context;
  return {
    hypertask_list_connections: tool({
      description:
        "List OAuth clients connected to the signed-in account, including the latest authorization and associated agent. Never returns credentials.",
      inputSchema: z.object({}).strict(),
      execute: withToolErrors(async () => {
        sendStatus("hypertask_list_connections");
        if (actingAgentId) {
          return { success: false, error: "Native agents cannot inspect account connections." };
        }
        return sanitizeForJson({
          success: true,
          connections: await listOwnedConnections(user.id),
        });
      }),
    }),
  };
}
