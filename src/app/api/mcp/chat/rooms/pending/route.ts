import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkMcpRateLimit, validateMcpAuth } from "@/lib/mcp/auth";
import { HTPR_6557_AGENT_ROOMS_FLAG, isFeatureEnabled } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PENDING_ROOM_MESSAGE_LIMIT = 50;

export async function GET(request: NextRequest) {
  try {
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
    if (!(await isFeatureEnabled(HTPR_6557_AGENT_ROOMS_FLAG, ctx.user.id))) {
      return NextResponse.json({ success: true, messages: [] });
    }

    const deliveries = await prisma.agentRoomDelivery.findMany({
      where: {
        agentId: ctx.agentId,
        agent: { revokedAt: null, archivedAt: null },
        handledAt: null,
        message: {
          stoppedAt: null,
          room: {
            project: {
              status: "Normal",
              members: {
                some: {
                  agentId: ctx.agentId,
                  status: "Accepted",
                  agent: { revokedAt: null, archivedAt: null },
                },
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: PENDING_ROOM_MESSAGE_LIMIT,
      select: {
        message: {
          select: {
            id: true,
            roomId: true,
            content: true,
            botTurnDepth: true,
            authorUser: { select: { displayName: true } },
            authorAgent: { select: { displayName: true } },
            task: { select: { ticketNumber: true } },
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      messages: deliveries.map(({ message }) => ({
        id: message.id,
        roomId: message.roomId,
        text: message.content,
        userName:
          message.authorAgent?.displayName ??
          message.authorUser?.displayName ??
          null,
        ticketNumber: message.task?.ticketNumber ?? null,
        botTurnDepth: message.botTurnDepth,
      })),
    });
  } catch (error) {
    console.error("[mcp agent-room] pending failed", error);
    return NextResponse.json(
      { success: false, error: "Failed to load pending room messages" },
      { status: 500 },
    );
  }
}
