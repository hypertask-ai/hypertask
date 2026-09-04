import { NextRequest, NextResponse } from "next/server";
import {
  agentRunsEnabledFor,
  authenticateAgentRunRequest,
  browserMutationIsSameOrigin,
  selectAgentRunActivity,
} from "@/lib/agentRuns/service";
import {
  AgentRunActivityInputError,
  AgentRunNotActiveError,
  AgentRunSelectionConflictError,
  parseAgentRunSelection,
} from "@/lib/agentRuns/model";
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
  {
    params,
  }: { params: Promise<{ id: string; activityId: string }> },
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
    if (principal.source !== "browser") {
      return noStore(
        { success: false, error: "Selecting an option requires a browser session" },
        403,
      );
    }
    if (!browserMutationIsSameOrigin(request)) {
      return noStore({ success: false, error: "Cross-origin request rejected" }, 403);
    }
    if (!(await agentRunsEnabledFor(principal))) {
      return noStore({ success: false, error: "Run not found" }, 404);
    }

    const selectedValue = parseAgentRunSelection(
      await request.json().catch(() => null),
    );
    const { id, activityId } = await params;
    const result =
      id.trim() && activityId.trim()
        ? await selectAgentRunActivity(
            principal,
            id.trim(),
            activityId.trim(),
            selectedValue,
          )
        : null;
    if (!result) {
      return noStore({ success: false, error: "Activity not found" }, 404);
    }
    return noStore({ success: true, ...result });
  } catch (error) {
    if (error instanceof AgentRunActivityInputError) {
      return noStore({ success: false, error: error.message }, 400);
    }
    if (
      error instanceof AgentRunSelectionConflictError ||
      error instanceof AgentRunNotActiveError
    ) {
      return noStore({ success: false, error: error.message }, 409);
    }
    console.error("[agent-run] activity selection failed", error);
    return noStore({ success: false, error: "Failed to select run activity" }, 500);
  }
}
