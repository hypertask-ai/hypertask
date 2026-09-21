import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskCreateAgentTool(context: ChatToolContext) {
  const { actingAgentId, invokeAgentManagementHandler, requireAccountManagementConfirmation, sendStatus, tool, withToolErrors, z } = context;
  return tool({
      description:
        "Create an external agent identity and optionally add it to boards. The returned MCP token is shown once. Always preview and obtain confirmation in a later message.",
      inputSchema: z
        .object({
          display_name: z.string().trim().min(1).max(60),
          project_ids: z.array(z.number().int().positive()).max(100).default([]),
          role: z.enum(["read", "write", "admin"]).default("write"),
          confirmed: z.boolean().optional(),
        })
        .strict(),
      execute: withToolErrors(async ({ confirmed, ...input }) => {
        sendStatus("hypertask_create_agent");
        if (actingAgentId) {
          return { success: false, error: "Native agents cannot manage account credentials." };
        }
        const preview = await requireAccountManagementConfirmation(
          "create-agent",
          input,
          confirmed,
          `This would create external agent “${input.display_name}” with role ${input.role}.`
        );
        if (preview) return preview;
        return invokeAgentManagementHandler("create", input);
      }),
    });
}
