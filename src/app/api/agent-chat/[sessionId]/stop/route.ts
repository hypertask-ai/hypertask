import { getSessionUser } from "@/lib/auth/getSessionUser";
import { loadUserAgentChatSession, sidebarChatProjectId } from "@/lib/agents/chatAccess";
import { NextRequest, NextResponse } from "next/server";
import { authenticateAgentRunRequest, browserMutationIsSameOrigin, stopAgentChatTurn } from "@/lib/agentRuns/service";
import { checkMcpRateLimit } from "@/lib/mcp/auth";
export const runtime = "nodejs";
const respond = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(
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
    if (sidebarChatProjectId(request.headers) !== undefined) {
      const sessionUser = await getSessionUser(request.headers);
      if (!sessionUser) return respond({ success: false, error: "Unauthorized" }, 401);
      const access = await loadUserAgentChatSession({ sessionId, userId: sessionUser.userId,
        actingAgentId: sessionUser.agentId, sidebarProjectId: sidebarChatProjectId(request.headers), select: {} });
      if (!access.ok) return respond({ success: false, error: access.error }, access.status);
    }
    if (!sessionId || !(await stopAgentChatTurn(principal, sessionId))) return respond({ success: false, error: "Active run not found" }, 404);
    return respond({ success: true });
  } catch (error) {
    console.error("[agent-chat] stop failed", error);
    return respond({ success: false, error: "Failed to stop agent run" }, 500);
  }
}
