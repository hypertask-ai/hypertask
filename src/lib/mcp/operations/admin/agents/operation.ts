import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { handleCreateAgentRequest } from "@/lib/mcp/agents/create";
import { handleListAgentsRequest } from "@/lib/mcp/agents/list";
import { handleRevokeAgentRequest } from "@/lib/mcp/agents/revoke";
import type { NextRequest } from "next/server";

export const GET = wrapMcpRoute((request: NextRequest) =>
  handleListAgentsRequest(request, "management"));
export const POST = wrapMcpRoute((request: NextRequest) =>
  handleCreateAgentRequest(request, "management"));
export const DELETE = wrapMcpRoute((request: NextRequest) =>
  handleRevokeAgentRequest(request, "management"));
