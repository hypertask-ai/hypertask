import { TaskTeamScopeError } from "@/lib/mcp/tasks/agentMutationFence"
import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from "next/server";
import {
  authenticateAgentRunRequest,
  browserMutationIsSameOrigin,
  runtimeAgentRunsEnabledFor,
  stopAgentRun,
} from "@/lib/agentRuns/service";
import {
  AgentRunInputError,
  parseAgentRunStopInput,
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
  { params }: { params: Promise<{ id: string }> },
) {
  return wrapMcpRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
      principal.credentialSource !== "cli-bearer" &&
      !browserMutationIsSameOrigin(request)
    ) {
      return noStore({ success: false, error: "Cross-origin request rejected" }, 403);
    }

    const rawBody = await request.text();
    let body: unknown = null;
    if (rawBody.trim()) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        throw new AgentRunInputError("Invalid JSON request body");
      }
      if (!(await runtimeAgentRunsEnabledFor(principal))) {
        return noStore({ success: false, error: "Run not found" }, 404);
      }
    }
    const finalStatus = parseAgentRunStopInput(body);
    const id = (await params).id.trim();
    const run = id
      ? await stopAgentRun(principal, id, new Date(), finalStatus)
      : null;
    if (!run) return noStore({ success: false, error: "Run not found" }, 404);
    return noStore({ success: true, run });
  } catch (error) {
    if (error instanceof TaskTeamScopeError) return noStore({ success: false, error: error.message }, 404)
    if (error instanceof AgentRunInputError) {
      return noStore({ success: false, error: error.message }, 400);
    }
    console.error("[agent-run] stop failed", error);
    return noStore({ success: false, error: "Failed to stop agent run" }, 500);
  }

  })(request, { params })
}
