import { NextRequest, NextResponse } from "next/server";
import { wrapMcpRoute, checkMcpRouteRateLimit, validateMcpRouteAuth } from "@/lib/mcp/routeWrapper";
import { getBoardAccessRequestSchema } from "@/lib/agents/boardAccessRequests/contracts";
import { BoardAccessError, getBoardAccessRequest, recordBoardAccessDenial } from "@/lib/agents/boardAccessRequests/service";

export const GET = wrapMcpRoute(async (request: NextRequest, context: { params: Promise<{ requestId: string }> }) => {
  const limited = await checkMcpRouteRateLimit(request);
  if (limited) return limited;
  const ctx = await validateMcpRouteAuth(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const input = getBoardAccessRequestSchema.safeParse({ request_id: (await context.params).requestId });
  if (!input.success) {
    await recordBoardAccessDenial({ userId: ctx.user.id, agentId: ctx.agentId, credential: "agent_bearer" }, "status", "invalid_input");
    return NextResponse.json({ error: "Request unavailable" }, { status: 404 });
  }
  try {
    return NextResponse.json({ success: true, ...await getBoardAccessRequest(ctx, input.data.request_id) });
  } catch (error) {
    if (!(error instanceof BoardAccessError)) throw error;
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
});
