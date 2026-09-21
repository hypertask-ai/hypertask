import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";
import type { AgentManagementDatabase } from "@/lib/mcp/agents/ownedAgents";

export function createHypertaskListAgentsTool(context: ChatToolContext) {
  const { actingAgentId, listOwnedAgents, prisma, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "List the signed-in user's managed agent identities and board memberships. Never returns credentials.",
      inputSchema: z.object({}).strict(),
      execute: withToolErrors(async () => {
        sendStatus("hypertask_list_agents");
        if (actingAgentId) {
          return { success: false, error: "Native agents cannot manage account credentials." };
        }
        return sanitizeForJson({
          success: true,
          agents: await listOwnedAgents(
            prisma as unknown as AgentManagementDatabase,
            user.id
          ),
        });
      }),
    });
}
