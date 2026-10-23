import { wrapMcpRoute, validateMcpRouteAuth as validateMcpAuth, checkMcpRouteRateLimit as checkMcpRateLimit } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from "next/server";

import { applyView } from "@/lib/mcp/views/services";

export async function POST(request: NextRequest, props: { params: Promise<{ viewId: string }> }) {
  return wrapMcpRoute(async (request: NextRequest) => {
  try {
    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;
    const ctx = await validateMcpAuth(request);

    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "Unauthorized. Invalid or missing authentication token." },
        { status: 401 },
      );
    }
    const { viewId } = await props.params;
    const result = await applyView({ viewId, userId: ctx.user.id, agentId: ctx.agentId, teamScope: ctx.teamScope });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Error switching view:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Internal server error" },
      { status: 400 },
    );
  }

  })(request)
}
