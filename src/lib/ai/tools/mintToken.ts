import { tool } from "ai";
import { z } from "zod";
import { mintAccountMcpToken } from "@/lib/mcp/accountTokens";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createMintTokenTool(context: ToolContext) {
  const { sendStatus, actingAgentId, requireAccountManagementConfirmation, user } = context;
  return {
    hypertask_mint_token: tool({
      description:
        "Mint a fresh account MCP bearer token for 1–365 days. The credential is shown once. Always preview and obtain confirmation in a later message.",
      inputSchema: z
        .object({
          expires_in_days: z.number().int().min(1).max(365).default(30),
          confirmed: z.boolean().optional(),
        })
        .strict(),
      execute: withToolErrors(async ({ confirmed, ...input }) => {
        sendStatus("hypertask_mint_token");
        if (actingAgentId) {
          return { success: false, error: "Native agents cannot manage account credentials." };
        }
        const preview = await requireAccountManagementConfirmation(
          "mint-token",
          input,
          confirmed,
          `This would mint a new ${input.expires_in_days}-day account MCP token.`
        );
        if (preview) return preview;
        return sanitizeForJson(
          mintAccountMcpToken(user, input.expires_in_days)
        );
      }),
    }),
  };
}
