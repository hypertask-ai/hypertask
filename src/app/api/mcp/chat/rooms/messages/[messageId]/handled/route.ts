import { withoutAuth } from "#with-auth";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkMcpRateLimit, validateMcpAuth } from "@/lib/mcp/auth";
import { loadAgentTokenRoom } from "@/lib/agents/roomAccess";
import { markAgentRoomMessageHandled } from "@/lib/agents/roomService";

export const runtime = "nodejs";

async function POSTHandler(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;
  const ctx = await validateMcpAuth(request);
  if (!ctx) {
    return NextResponse.json(
      { success: false, error: "Unauthorized. Invalid or missing authentication token." },
      { status: 401 },
    );
  }
  if (!ctx.agentId) {
    return NextResponse.json(
      { success: false, error: "Agent rooms require an agent token" },
      { status: 403 },
    );
  }
  const { messageId } = await params;
  const delivery = await prisma.agentRoomDelivery.findUnique({
    where: {
      messageId_agentId: { messageId, agentId: ctx.agentId },
    },
    select: { message: { select: { roomId: true } } },
  });
  if (
    !delivery ||
    !(await loadAgentTokenRoom(delivery.message.roomId, ctx.agentId))
  ) {
    return NextResponse.json(
      { success: false, error: "Pending room message not found" },
      { status: 404 },
    );
  }
  await markAgentRoomMessageHandled({ messageId, agentId: ctx.agentId });
  return NextResponse.json({ success: true });
}

export const POST = withoutAuth(POSTHandler);
