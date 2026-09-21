import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskMintTokenTool(context: ChatToolContext) {
  const { actingAgentId, mintAccountMcpToken, requireAccountManagementConfirmation, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
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
    });
}
