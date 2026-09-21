import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskRevokeAgentTool(context: ChatToolContext) {
  const { actingAgentId, invokeAgentManagementHandler, requireAccountManagementConfirmation, sendStatus, tool, withToolErrors, z } = context;
  return tool({
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
    });
}
