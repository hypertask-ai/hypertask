import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskListConnectionsTool(context: ChatToolContext) {
  const { actingAgentId, listOwnedConnections, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
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
    });
}
