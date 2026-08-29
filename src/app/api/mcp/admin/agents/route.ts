import { handleCreateAgentRequest } from "@/lib/mcp/agents/create";
import { handleListAgentsRequest } from "@/lib/mcp/agents/list";
import { handleRevokeAgentRequest } from "@/lib/mcp/agents/revoke";
import type { NextRequest } from "next/server";

export const GET = (request: NextRequest) =>
  handleListAgentsRequest(request, "management");
export const POST = (request: NextRequest) =>
  handleCreateAgentRequest(request, "management");
export const DELETE = (request: NextRequest) =>
  handleRevokeAgentRequest(request, "management");
