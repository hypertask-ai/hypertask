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

/** GET /api/mcp/chat/pending */
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
    const agentId = ctx.agentId;
    if (!agentId) {
      return NextResponse.json(
        { success: false, error: "Agent Chat requires an agent token" },
        { status: 403 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // The send path takes this lock before deciding between webhook,
      // polling, and parked delivery. A poll can therefore never miss a send
      // that was committed as polling work.
      const agents = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "Agent"
        WHERE "id" = ${agentId}
          AND "revokedAt" IS NULL
        FOR UPDATE
      `;
      if (agents.length !== 1) return { found: false, messages: [] };

      // Existing webhook agents stay entirely on the webhook path.
      const subscription = await tx.agentWebhookSubscription.findUnique({
        where: { agentId: agentId },
        select: { active: true },
      });
      if (subscription?.active) return { found: true, messages: [] };

      const messages = await tx.$queryRaw<PendingChatMessage[]>`
        WITH pending AS (
          SELECT
            message."id",
            message."sessionId",
            message."content" AS "text",
            COALESCE(author."displayName", owner."displayName") AS "userName",
            message."createdAt"
          FROM "ChatMessage" message
          JOIN "ChatSession" session ON session."id" = message."sessionId"
          JOIN "User" owner ON owner."id" = session."userId"
          LEFT JOIN "User" author ON author."id" = message."authorUserId"
          WHERE session."agentId" = ${agentId}
            AND message."role" = 'human'::"ChatRole"
            AND message."isDelivered" = false
            AND NOT EXISTS (
              SELECT 1
              FROM "ChatMessage" reply
              WHERE reply."replyToMessageId" = message."id"
            )
          ORDER BY message."createdAt" ASC, message."id" ASC
          FOR UPDATE OF message SKIP LOCKED
          LIMIT ${PENDING_MESSAGE_LIMIT}
        ), delivered AS (
          UPDATE "ChatMessage" message
          SET "isDelivered" = true
          FROM pending
          WHERE message."id" = pending."id"
          RETURNING message."id"
        )
        SELECT pending."id", pending."sessionId", pending."text", pending."userName"
        FROM pending
        JOIN delivered ON delivered."id" = pending."id"
        ORDER BY pending."createdAt" ASC, pending."id" ASC
      `;
      return { found: true, messages };
    });

    if (!result.found) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, messages: result.messages });
  } catch (error) {
    console.error("[mcp chat] GET pending failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load pending chat messages" },
      { status: 500 },
    );
  }
}
