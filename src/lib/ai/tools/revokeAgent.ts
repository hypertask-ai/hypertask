import { tool } from "ai";
import { z } from "zod";
import { withToolErrors } from "@/lib/ai/tools/execution";

import type { ToolContext } from "./context";

export function createRevokeAgentTool(context: ToolContext) {
  const { sendStatus, actingAgentId, requireAccountManagementConfirmation, invokeAgentManagementHandler } = context;
  return {
    hypertask_revoke_agent: tool({
      description:
        "Revoke an owned external agent and invalidate its MCP token. Always preview and obtain confirmation in a later message.",
      inputSchema: z
        .object({
          agent_id: z.string().trim().min(1),
          confirmed: z.boolean().optional(),
        })
        .strict(),
      execute: withToolErrors(async ({ confirmed, ...input }) => {
        sendStatus("hypertask_revoke_agent");
        if (actingAgentId) {
          return { success: false, error: "Native agents cannot manage account credentials." };
        }
        const preview = await requireAccountManagementConfirmation(
          "revoke-agent",
          input,
          confirmed,
          `This would revoke agent ${input.agent_id} and invalidate its token.`
        );
        if (preview) return preview;
        return invokeAgentManagementHandler("revoke", input);
      }),
    }),
  };
}
