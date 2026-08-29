import { NextRequest, NextResponse } from "next/server";

import {
  checkMcpRateLimit,
  createUnauthorizedResponse,
  validateManagementOrSessionAuth,
} from "@/lib/mcp/auth";
import { listOwnedConnections } from "@/lib/mcp/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;

  const ctx = await validateManagementOrSessionAuth(request, "read");
  if (!ctx) return createUnauthorizedResponse();

  try {
    return NextResponse.json({
      success: true,
      connections: await listOwnedConnections(ctx.user.id),
    });
  } catch (error) {
    console.error("[Admin Connections] Failed to list connections:", error);
    return NextResponse.json(
      { success: false, error: "Failed to list connections" },
      { status: 500 },
    );
  }
}
