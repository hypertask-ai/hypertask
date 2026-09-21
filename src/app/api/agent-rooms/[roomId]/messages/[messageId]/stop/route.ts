import { getAuthSession, withAuth } from "#with-auth";
import { NextRequest, NextResponse } from "next/server";
import { loadUserAgentRoom } from "@/lib/agents/roomAccess";
import { stopAgentRoomTurn } from "@/lib/agents/roomService";

export const runtime = "nodejs";

async function POSTHandler(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ roomId: string; messageId: string }> },
) {
  const userId = (await getAuthSession(request.headers))?.userId;
  if (!userId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const { roomId, messageId } = await params;
  if (!(await loadUserAgentRoom(roomId, userId))) {
    return NextResponse.json(
      { success: false, error: "Room not found" },
      { status: 404 },
    );
  }
  const stopped = await stopAgentRoomTurn({ roomId, messageId });
  return stopped
    ? NextResponse.json({ success: true })
    : NextResponse.json(
        { success: false, error: "Running turn not found" },
        { status: 404 },
      );
}

export const POST = withAuth(POSTHandler);
