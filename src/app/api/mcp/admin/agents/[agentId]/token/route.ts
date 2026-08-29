import { handleRotateAgentTokenRequest } from "@/lib/mcp/agents/rotateToken";
import type { NextRequest } from "next/server";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await context.params;
  return handleRotateAgentTokenRequest(request, agentId, "management");
}
