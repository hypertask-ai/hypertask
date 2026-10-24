import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { isGuestUserId } from "@/lib/demo/guestGuard";
import { decideBoardAccessRequestSchema, getBoardAccessRequestSchema } from "@/lib/agents/boardAccessRequests/contracts";
import { BoardAccessError, decideBoardAccessRequest, recordBoardAccessDenial } from "@/lib/agents/boardAccessRequests/service";

export async function POST(request: NextRequest, context: { params: Promise<{ requestId: string }> }) {
  const session = await getSessionUser(request.headers);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = getBoardAccessRequestSchema.safeParse({ request_id: (await context.params).requestId });
  const actor = { userId: session.userId, agentId: session.agentId,
    credential: session.agentId ? "agent_cookie" as const : session.source === "cli-bearer" ? "cli_bearer" as const : "human_cookie" as const };
  if (request.headers.has("authorization") || !request.headers.get("cookie") ||
      request.headers.get("origin") !== new URL(request.url).origin ||
      request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    await recordBoardAccessDenial(actor, "decision", "same_origin_cookie_required", id.success ? id.data.request_id : undefined);
    return NextResponse.json({ error: "Human owner session and same-origin JSON required" }, { status: 403 });
  }
  if (session.agentId || session.source === "cli-bearer" || await isGuestUserId(session.userId)) {
    await recordBoardAccessDenial(actor, "decision", "human_owner_required", id.success ? id.data.request_id : undefined);
    return NextResponse.json({ error: "Human owner required" }, { status: 403 });
  }
  const input = decideBoardAccessRequestSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !input.success) {
    await recordBoardAccessDenial(actor, "decision", "invalid_input", id.success ? id.data.request_id : undefined);
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  }
  try {
    return NextResponse.json({ success: true, ...await decideBoardAccessRequest(session, id.data.request_id, input.data.decision) });
  } catch (error) {
    if (!(error instanceof BoardAccessError)) throw error;
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
}
