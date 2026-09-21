import { logger as htLogger } from "#logger";
import { getAuthSession, withAuth } from "#with-auth";
import { NextRequest, NextResponse } from "next/server";
import { loadUserAgentRoom } from "@/lib/agents/roomAccess";
import { AgentRoomError, listAgentRoom } from "@/lib/agents/roomService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function GETHandler(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const userId = (await getAuthSession(request.headers))?.userId;
    if (!userId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const { roomId } = await params;
    if (!(await loadUserAgentRoom(roomId, userId))) {
      return NextResponse.json(
        { success: false, error: "Room not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, ...(await listAgentRoom(roomId)) });
  } catch (error) {
    htLogger.error("[agent-room] load failed", error);
    const status = error instanceof AgentRoomError ? error.status : 500;
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load room",
      },
      { status },
    );
  }
}

export const GET = withAuth(GETHandler);
