import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { HTPR_6533_MCP_CLIENT_EVAL_FLAG, isFeatureEnabled } from "@/lib/flags";
import type { McpClientEvalReport } from "@/lib/mcpClientEval/types";
import latest from "@/lib/mcpClientEval/latest.json";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session?.userId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  if (!(await isFeatureEnabled(HTPR_6533_MCP_CLIENT_EVAL_FLAG, session.userId))) {
    return NextResponse.json(
      { success: false, error: "Not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    success: true,
    report: latest as McpClientEvalReport,
  });
}
