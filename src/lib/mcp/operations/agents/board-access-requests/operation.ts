import { NextRequest, NextResponse } from "next/server";
import { wrapMcpRoute, checkMcpRouteRateLimit, validateMcpRouteAuth } from "@/lib/mcp/routeWrapper";
import { createBoardAccessRequestSchema } from "@/lib/agents/boardAccessRequests/contracts";
import { BoardAccessError, createBoardAccessRequest, recordBoardAccessDenial } from "@/lib/agents/boardAccessRequests/service";

export const POST = wrapMcpRoute(async (request: NextRequest) => {
  const limited = await checkMcpRouteRateLimit(request);
  if (limited) return limited;
  const ctx = await validateMcpRouteAuth(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const input = createBoardAccessRequestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    await recordBoardAccessDenial({ userId: ctx.user.id, agentId: ctx.agentId, credential: "agent_bearer" }, "create", "invalid_input");
    return NextResponse.json({ error: "Expected project_id and a plain text reason (1–1000 characters)" }, { status: 400 });
  }
  try {
    const result = await createBoardAccessRequest(ctx, input.data);
    return NextResponse.json({ success: true, ...result }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (!(error instanceof BoardAccessError)) throw error;
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status,
      ...(error.retryAfter ? { headers: { "Retry-After": String(error.retryAfter) } } : {}) });
  }
});
