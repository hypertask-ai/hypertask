import { logger as htLogger } from "#logger";
import { withoutAuth } from "#with-auth";
import { NextRequest, NextResponse } from "next/server";
import { checkMcpRateLimit, validateMcpAuth } from "@/lib/mcp/auth";
import { loadAgentTokenRoom } from "@/lib/agents/roomAccess";
import {
  AgentRoomError,
  createAgentRoomReply,
  listAgentRoom,
} from "@/lib/agents/roomService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function roomAgent(
  request: NextRequest,
  roomId: string,
): Promise<
  | { response: NextResponse; agentId: null }
  | { response: null; agentId: string }
> {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return { response: rateLimited, agentId: null };
  const ctx = await validateMcpAuth(request);
  if (!ctx) {
    return {
      response: NextResponse.json(
        { success: false, error: "Unauthorized. Invalid or missing authentication token." },
        { status: 401 },
      ),
      agentId: null,
    };
  }
  if (!ctx.agentId) {
    return {
      response: NextResponse.json(
        { success: false, error: "Agent rooms require an agent token" },
        { status: 403 },
      ),
      agentId: null,
    };
  }
  if (!(await loadAgentTokenRoom(roomId, ctx.agentId))) {
    return {
      response: NextResponse.json(
        { success: false, error: "Room not found" },
        { status: 404 },
      ),
      agentId: null,
    };
  }
  return { response: null, agentId: ctx.agentId };
}

async function GETHandler(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const auth = await roomAgent(request, roomId);
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({ success: true, ...(await listAgentRoom(roomId)) });
  } catch (error) {
    htLogger.error("[mcp agent-room] transcript failed", error);
    return NextResponse.json(
      { success: false, error: "Failed to load room transcript" },
      { status: 500 },
    );
  }
}

async function POSTHandler(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const auth = await roomAgent(request, roomId);
  if (auth.response) return auth.response;
  try {
    const body = await request.json().catch(() => null);
    const result = await createAgentRoomReply({
      roomId,
      agentId: auth.agentId,
      text: typeof body?.text === "string" ? body.text : "",
      replyToMessageId:
        typeof body?.replyToMessageId === "string"
          ? body.replyToMessageId
          : "",
      ticketNumber:
        typeof body?.ticketNumber === "string" ? body.ticketNumber : null,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    htLogger.error("[mcp agent-room] reply failed", error);
    const status = error instanceof AgentRoomError ? error.status : 500;
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to post room reply",
      },
      { status },
    );
  }
}

export const GET = withoutAuth(GETHandler);
export const POST = withoutAuth(POSTHandler);
