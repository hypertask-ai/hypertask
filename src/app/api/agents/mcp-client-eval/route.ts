import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { HTPR_6533_MCP_CLIENT_EVAL_FLAG, isFeatureEnabled } from "@/lib/flags";
import type { McpClientEvalReport } from "@/lib/mcpClientEval/types";
import latest from "@/lib/mcpClientEval/latest.json";

export const runtime = "nodejs";

export const MCP_CLIENT_EVAL_REPORT_URL =
  process.env.MCP_CLIENT_EVAL_REPORT_URL ||
  "https://raw.githubusercontent.com/hypertask-ai/hypertask/eval-reports/latest.json";

async function loadPublishedReport(): Promise<McpClientEvalReport> {
  try {
    const response = await fetch(MCP_CLIENT_EVAL_REPORT_URL, {
      cache: "no-store",
    });
    if (response.ok) {
      return (await response.json()) as McpClientEvalReport;
    }
  } catch {
    // Fall back to the last committed report when the published branch is empty.
  }
  return latest as McpClientEvalReport;
}

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
    report: await loadPublishedReport(),
  });
}
