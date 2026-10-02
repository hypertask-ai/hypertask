import { tool } from "ai";
import { z } from "zod";
import { listOwnedAgents, type AgentManagementDatabase } from "@/lib/mcp/agents/ownedAgents";
import prisma from "@/lib/prisma";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createListAgentsTool(context: ToolContext) {
  const { sendStatus, actingAgentId, user } = context;
  return {
    hypertask_list_agents: tool({
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
    }),
  };
}
