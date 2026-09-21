import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
import { NextRequest, NextResponse } from "next/server";
import { authenticateAgentRunRequest, browserMutationIsSameOrigin, stopAgentChatTurn } from "@/lib/agentRuns/service";
import { checkMcpRateLimit } from "@/lib/mcp/auth";
export const runtime = "nodejs";
const respond = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
async function POSTHandler(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;
    const principal = await authenticateAgentRunRequest(request);
    if (!principal || principal.source !== "browser") return respond({ success: false, error: "Unauthorized" }, 401);
    if (!browserMutationIsSameOrigin(request)) return respond({ success: false, error: "Cross-origin request rejected" }, 403);
    const sessionId = (await params).sessionId.trim();
    if (!sessionId || !(await stopAgentChatTurn(principal, sessionId))) return respond({ success: false, error: "Active run not found" }, 404);
    return respond({ success: true });
  } catch (error) {
    htLogger.error("[agent-chat] stop failed", error);
    return respond({ success: false, error: "Failed to stop agent run" }, 500);
  }
}

export const POST = withAuth(POSTHandler, { authenticateInHandler: true });
