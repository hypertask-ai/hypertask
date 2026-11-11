import { wrapMcpRoute, checkMcpRouteRateLimit as checkMcpRateLimit, validateMcpRouteAuth as validateMcpAuth } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from "next/server";

import { Prisma } from "@prisma/client";
import { chatContentScopeWhere } from "@/lib/agents/chatContentScope";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7734_AGENT_CHAT_CONTEXT_FLAG } from "@/lib/flags/definitions/htpr-7734-agent-chat-context";
import { HTPR_7742_AGENT_CHAT_ALL_FLAG } from "@/lib/flags/definitions/htpr-7742-agent-chat-all";
import { agentChatContextPayload, readableAgentChatContextIds } from "@/lib/agents/chatContext";
import { refreshAgentChatHeartbeat } from "@/lib/agents/chatHeartbeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PENDING_MESSAGE_LIMIT = 50;

type PendingChatMessage = {
  id: string;
  sessionId: string;
  text: string;
  context?: Prisma.JsonValue;
  userName: string | null;
};

export async function GET(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
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

    const contextEnabled = await isFeatureEnabled(HTPR_7734_AGENT_CHAT_CONTEXT_FLAG, ctx.user.id);
    const chatAllEnabled = await isFeatureEnabled(HTPR_7742_AGENT_CHAT_ALL_FLAG, ctx.user.id);
    const unanswered = new URL(request.url).searchParams.get("unanswered") === "true";
    if (unanswered && !chatAllEnabled) {
      return NextResponse.json({ success: false, error: "Chat inbox is not enabled" }, { status: 404 });
    }
    const result = await prisma.$transaction(async (tx) => {
      const agents = await tx.$queryRaw<Array<{ id: string; userId: number }>>`
        SELECT "id", "userId"
        FROM "Agent"
        WHERE "id" = ${agentId}
          AND "revokedAt" IS NULL
        FOR UPDATE
      `;
      if (agents.length !== 1) return { found: false, messages: [], readableContextIds: new Set<string>() };
      const agent = agents[0];
      if (unanswered && !await refreshAgentChatHeartbeat(tx, agentId, ctx.user.id)) {
        return { found: false, messages: [], readableContextIds: new Set<string>() };
      }

      const subscription = await tx.agentWebhookSubscription.findUnique({
        where: { agentId: agentId },
        select: { active: true, events: true },
      });
      if (!unanswered && subscription?.active && (!chatAllEnabled || subscription.events.includes("chat.message"))) {
        return { found: true, messages: [], readableContextIds: new Set<string>() };
      }

      const allowedSessions = ctx.teamScope != null ? await tx.chatSession.findMany({
        where: { agentId, ...await chatContentScopeWhere({ userId: ctx.user.id, agentId, teamScope: ctx.teamScope }, tx) }, select: { id: true },
      }) : null;
      const sessionScope = allowedSessions === null ? Prisma.empty : allowedSessions.length ? Prisma.sql`AND session.id IN (${Prisma.join(allowedSessions.map(({ id }) => id))})` : Prisma.sql`AND FALSE`;
      const messages = await tx.$queryRaw<PendingChatMessage[]>`
        WITH pending AS (
          SELECT
            message."id",
            message."sessionId",
            message."content" AS "text",
            ${contextEnabled ? Prisma.sql`message."context"` : Prisma.sql`NULL::jsonb`} AS "context",
            COALESCE(author."displayName", owner."displayName") AS "userName",
            message."createdAt"
          FROM "ChatMessage" message
          JOIN "ChatSession" session ON session."id" = message."sessionId"
          JOIN "User" owner ON owner."id" = session."userId"
          LEFT JOIN "User" author ON author."id" = message."authorUserId"
          WHERE session."agentId" = ${agentId}
            ${sessionScope}
            AND message."role" = 'human'::"ChatRole"
            ${unanswered ? Prisma.empty : Prisma.sql`AND message."isDelivered" = false`}
            AND NOT EXISTS (
              SELECT 1
              FROM "ChatMessage" reply
              WHERE reply."replyToMessageId" = message."id"
            )
          ORDER BY message."createdAt" ASC, message."id" ASC
          FOR UPDATE OF message SKIP LOCKED
          LIMIT ${PENDING_MESSAGE_LIMIT}
        ), delivered AS (
          ${unanswered ? Prisma.sql`SELECT "id" FROM pending` : Prisma.sql`
            UPDATE "ChatMessage" message
            SET "isDelivered" = true
            FROM pending
            WHERE message."id" = pending."id"
            RETURNING message."id"
          `}
        )
        SELECT pending."id", pending."sessionId", pending."text", pending."context", pending."userName"
        FROM pending
        JOIN delivered ON delivered."id" = pending."id"
        ORDER BY pending."createdAt" ASC, pending."id" ASC
      `;
      const readableContextIds = contextEnabled
        ? await readableAgentChatContextIds(tx, { userId: agent.userId, agentId, teamScope: ctx.teamScope }, messages)
        : new Set<string>();
      return { found: true, messages, readableContextIds };
    }, ctx.teamScope != null ? { isolationLevel: "Serializable" } : undefined);

    if (!result.found) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 },
      );
    }
    const messages = result.messages.map(({ context, ...message }) => ({
      ...message,
      ...(result.readableContextIds.has(message.id) ? agentChatContextPayload(message.text, context) : {}),
    }));
    return NextResponse.json({ success: true, messages });
  } catch (error) {
    console.error("[mcp chat] GET pending failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load pending chat messages" },
      { status: 500 },
    );
  }

  })(request)
}
