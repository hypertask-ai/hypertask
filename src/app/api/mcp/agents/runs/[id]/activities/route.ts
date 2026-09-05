import { NextRequest, NextResponse } from "next/server";
import {
  agentRunActivitiesEnabledFor,
  authenticateAgentRunRequest,
  createAgentRunActivity,
  listAgentRunActivities,
} from "@/lib/agentRuns/service";
import {
  AgentRunActivityConflictError,
  AgentRunActivityInProgressError,
  AgentRunActivityInputError,
  AgentRunNotActiveError,
  parseAgentRunActivityInput,
} from "@/lib/agentRuns/model";
import { checkMcpRateLimit } from "@/lib/mcp/auth";
import { normalizeIdempotencyKey } from "@/lib/mcp/idempotency/idempotencyStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = (
  body: Record<string, unknown>,
  status = 200,
  retryAfterSeconds?: number,
) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      ...(retryAfterSeconds
        ? { "Retry-After": String(retryAfterSeconds) }
        : {}),
    },
  });

async function authorize(request: NextRequest) {
  const principal = await authenticateAgentRunRequest(request);
  if (!principal) {
    return {
      response: noStore(
        { success: false, error: "Invalid or missing authentication" },
        401,
      ),
    };
  }
  if (!(await agentRunActivitiesEnabledFor(principal))) {
    return {
      response: noStore({ success: false, error: "Run not found" }, 404),
    };
  }
  return { principal };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;

  try {
    const authorization = await authorize(request);
    if (authorization.response) return authorization.response;
    const id = (await params).id.trim();
    const activities = id
      ? await listAgentRunActivities(authorization.principal!, id)
      : null;
    if (!activities) {
      return noStore({ success: false, error: "Run not found" }, 404);
    }
    return noStore({ success: true, activities });
  } catch (error) {
    console.error("[agent-run] activity list failed", error);
    return noStore({ success: false, error: "Failed to list run activities" }, 500);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;

  try {
    const authorization = await authorize(request);
    if (authorization.response) return authorization.response;
    const principal = authorization.principal!;
    if (principal.source !== "agent") {
      return noStore(
        { success: false, error: "Creating activities requires an agent token" },
        403,
      );
    }

    const input = parseAgentRunActivityInput(
      await request.json().catch(() => null),
    );
    const idempotencyKey = normalizeIdempotencyKey(
      request.headers.get("Idempotency-Key"),
    );
    const id = (await params).id.trim();
    const result = id
      ? await createAgentRunActivity(
          principal,
          id,
          input,
          idempotencyKey,
        )
      : null;
    if (!result) {
      return noStore({ success: false, error: "Run not found" }, 404);
    }
    return noStore({ success: true, ...result });
  } catch (error) {
    if (error instanceof AgentRunActivityInputError) {
      return noStore({ success: false, error: error.message }, 400);
    }
    if (error instanceof AgentRunActivityInProgressError) {
      return noStore(
        { success: false, error: error.message, retryable: true },
        503,
        1,
      );
    }
    if (
      error instanceof AgentRunActivityConflictError ||
      error instanceof AgentRunNotActiveError
    ) {
      return noStore({ success: false, error: error.message }, 409);
    }
    if (error instanceof Error && error.message.startsWith("Idempotency-Key")) {
      return noStore({ success: false, error: error.message }, 400);
    }
    console.error("[agent-run] activity create failed", error);
    return noStore({ success: false, error: "Failed to create run activity" }, 500);
  }
}
