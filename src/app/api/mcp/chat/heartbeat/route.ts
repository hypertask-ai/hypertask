import { NextRequest, NextResponse } from "next/server";
import { wrapMcpRoute, checkMcpRouteRateLimit, validateMcpRouteAuth } from "@/lib/mcp/routeWrapper";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7742_AGENT_CHAT_ALL_FLAG } from "@/lib/flags/definitions/htpr-7742-agent-chat-all";
import { refreshAgentChatHeartbeat } from "@/lib/agents/chatHeartbeat";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
    try {
      const rateLimited = await checkMcpRouteRateLimit(request);
      if (rateLimited) return rateLimited;
      const ctx = await validateMcpRouteAuth(request);
      if (!ctx) {
        return NextResponse.json({ success: false, error: "Unauthorized. Invalid or missing authentication token." }, { status: 401 });
      }
      if (!ctx.agentId) {
        return NextResponse.json({ success: false, error: "Agent Chat requires an agent token" }, { status: 403 });
      }
      if (!await isFeatureEnabled(HTPR_7742_AGENT_CHAT_ALL_FLAG, ctx.user.id)) {
        return NextResponse.json({ success: false, error: "Chat heartbeat is not enabled" }, { status: 404 });
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
      }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
        return NextResponse.json({ success: false, error: "Expected an empty object" }, { status: 400 });
      }

      const heartbeatAt = await refreshAgentChatHeartbeat(prisma, ctx.agentId, ctx.user.id);
      if (!heartbeatAt) {
        return NextResponse.json({ success: false, error: "Agent not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, heartbeat_at: heartbeatAt.toISOString() });
    } catch (error) {
      console.error("[mcp chat] POST heartbeat failed:", error);
      return NextResponse.json({ success: false, error: "Failed to record chat heartbeat" }, { status: 500 });
    }
  })(request);
}
