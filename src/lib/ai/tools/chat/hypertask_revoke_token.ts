import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskRevokeTokenTool(context: ChatToolContext) {
  const { actingAgentId, requireAccountManagementConfirmation, revokeAccountMcpToken, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "Revoke one signed account MCP token, or all account MCP tokens with revoke_all=true. Always preview and obtain confirmation in a later message.",
      inputSchema: z
        .object({
          token: z.string().trim().min(1).max(8192).optional(),
          revoke_all: z.literal(true).optional(),
          confirmed: z.boolean().optional(),
        })
        .strict()
        .refine((value) => Boolean(value.token) !== Boolean(value.revoke_all), {
          message: "Provide exactly one of token or revoke_all=true",
        }),
      execute: withToolErrors(async ({ confirmed, ...input }) => {
        sendStatus("hypertask_revoke_token");
        if (actingAgentId) {
          return { success: false, error: "Native agents cannot manage account credentials." };
        }
        const preview = await requireAccountManagementConfirmation(
          "revoke-token",
          input,
          confirmed,
          input.revoke_all
            ? "This would revoke every account MCP token."
            : "This would revoke the supplied account MCP token."
        );
        if (preview) return preview;
        return revokeAccountMcpToken(user.id, input);
      }),
    });
}
