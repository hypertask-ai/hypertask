import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { loadUserAgentRoom } from "@/lib/agents/roomAccess";
import {
  AgentRoomError,
  createHumanAgentRoomMessage,
} from "@/lib/agents/roomService";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const userId = (await getSessionUser(request.headers))?.userId;
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
    const body = await request.json().catch(() => null);
    const message = await createHumanAgentRoomMessage({
      roomId,
      userId,
      text: typeof body?.text === "string" ? body.text : "",
      ticketNumber:
        typeof body?.ticketNumber === "string" ? body.ticketNumber : null,
    });
    return NextResponse.json({ success: true, message });
  } catch (error) {
    console.error("[agent-room] send failed", error);
    const status = error instanceof AgentRoomError ? error.status : 500;
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to send message",
      },
      { status },
    );
  }
}
