import type { McpAuthContext } from "@/lib/mcp/auth/types";
import { getAgentRole } from "@/lib/mcp/agents/scopes";
import { boardAccessFeatureEnabled } from "@/lib/agents/boardAccessRequests/service";
import type { PortableTool } from "./stateless-http";

export async function boardAccessCatalog(tools: readonly PortableTool[], ctx?: McpAuthContext) {
  const enabled = Boolean(ctx?.agentId && !ctx.management && await boardAccessFeatureEnabled(ctx.user.id));
  const write = enabled && ctx && ["write", "admin"].includes(await getAgentRole(ctx));
  return tools.filter((tool) => tool.name === "hypertask_request_board_access" ? write : tool.name === "hypertask_get_board_access_request" ? enabled : true);
}
