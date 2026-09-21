import { withoutAuth } from "#with-auth";
import { handleRotateAgentTokenRequest } from "@/lib/mcp/agents/rotateToken";
import type { NextRequest } from "next/server";

async function POSTHandler(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await context.params;
  return handleRotateAgentTokenRequest(request, agentId, "management");
}

export const POST = withoutAuth(POSTHandler);
