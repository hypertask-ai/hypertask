import { NextRequest, NextResponse } from "next/server";
import { checkMcpRateLimit, validateMcpAuth } from "@/lib/mcp/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PENDING_MESSAGE_LIMIT = 50;

type PendingChatMessage = {
  id: string;
  sessionId: string;
  text: string;
  userName: string | null;
};

/**
 * GET /api/mcp/chat/pending
 *
 * Return unanswered human messages for the agent represented by the bearer
 * token. A reply's replyToMessageId makes the human turn terminal.
 */
export async function GET(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;
    const ctx = await validateMcpAuth(request);
    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized. Invalid or missing authentication token.",
        },
        { status: 401 },
      );
    }
    if (!ctx.agentId) {
      return NextResponse.json(
        { success: false, error: "Agent Chat requires an agent token" },
        { status: 403 },
      );
    }

    const heartbeat = await prisma.agent.updateMany({
      where: { id: ctx.agentId, revokedAt: null },
      data: { heartbeatAt: new Date() },
    });
    if (heartbeat.count !== 1) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 },
      );
    }

    const messages = await prisma.$queryRaw<PendingChatMessage[]>`
      SELECT
        message."id",
        message."sessionId",
        message."content" AS "text",
        COALESCE(author."displayName", owner."displayName") AS "userName"
      FROM "ChatMessage" message
      JOIN "ChatSession" session ON session."id" = message."sessionId"
      JOIN "User" owner ON owner."id" = session."userId"
      LEFT JOIN "User" author ON author."id" = message."authorUserId"
      WHERE session."agentId" = ${ctx.agentId}
        AND message."role" = 'human'::"ChatRole"
        AND message."isDelivered" = true
        AND NOT EXISTS (
          SELECT 1
          FROM "ChatMessage" reply
          WHERE reply."replyToMessageId" = message."id"
        )
      ORDER BY message."createdAt" ASC, message."id" ASC
      LIMIT ${PENDING_MESSAGE_LIMIT}
    `;

    return NextResponse.json({ success: true, messages });
  } catch (error) {
    console.error("[mcp chat] GET pending failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load pending chat messages" },
      { status: 500 },
    );
  }
}
