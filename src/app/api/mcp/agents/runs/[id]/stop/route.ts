import { NextRequest, NextResponse } from "next/server";
import {
  agentRunsEnabledFor,
  authenticateAgentRunRequest,
  browserMutationIsSameOrigin,
  stopAgentRun,
} from "@/lib/agentRuns/service";
import { checkMcpRateLimit } from "@/lib/mcp/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;

  try {
    const principal = await authenticateAgentRunRequest(request);
    if (!principal) {
      return noStore(
        { success: false, error: "Invalid or missing authentication" },
        401,
      );
    }
    if (
      principal.source === "browser" &&
      !browserMutationIsSameOrigin(request)
    ) {
      return noStore({ success: false, error: "Cross-origin request rejected" }, 403);
    }
    if (!(await agentRunsEnabledFor(principal))) {
      return noStore({ success: false, error: "Run not found" }, 404);
    }

    const id = (await params).id.trim();
    const run = id ? await stopAgentRun(principal, id) : null;
    if (!run) return noStore({ success: false, error: "Run not found" }, 404);
    return noStore({ success: true, run });
  } catch (error) {
    console.error("[agent-run] stop failed", error);
    return noStore({ success: false, error: "Failed to stop agent run" }, 500);
  }
}
