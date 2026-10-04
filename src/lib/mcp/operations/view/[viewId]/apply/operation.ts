import { NextRequest, NextResponse } from "next/server";
import { validateMcpAuth, checkMcpRateLimit } from "@/lib/mcp/auth";
import { applyView } from "@/lib/mcp/views/services";

/**
 * POST /api/mcp/view/[viewId]/apply -- switch the caller's active view on a board.
 * Passing the board's default view id returns them to the default (all tasks) view.
 */
export async function POST(request: NextRequest, props: { params: Promise<{ viewId: string }> }) {
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
    const result = await applyView({ viewId, userId: ctx.user.id, agentId: ctx.agentId });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Error switching view:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Internal server error" },
      { status: 400 },
    );
  }
}
