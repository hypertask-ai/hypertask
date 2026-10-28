import { TaskTeamScopeError } from "@/lib/mcp/tasks/agentMutationFence";
import { wrapMcpRoute, checkMcpRouteRateLimit as checkMcpRateLimit, validateMcpRouteAuth as validateMcpAuth } from '@/lib/mcp/routeWrapper'
import { NextRequest, NextResponse } from "next/server";

import { chatContentScopeWhere } from "@/lib/agents/chatContentScope";
import prisma from "@/lib/prisma";
import { broadcastChatSession } from "@/lib/agents/chatBroadcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ACTIVITY_LENGTH = 2000;
const ACTIVITY_ID_PREFIX = "loop-activity-";
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function requireAgentToken(ctxAgentId: string | null): NextResponse | null {
  if (ctxAgentId) return null;
  return NextResponse.json(
    { success: false, error: "Agent Chat activity requires an agent token" },
    { status: 403 }
  );
}

export async function POST(request: NextRequest) {
  return wrapMcpRoute(async (request: NextRequest) => {
  try {
    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;
    const ctx = await validateMcpAuth(request);
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "Unauthorized. Invalid or missing authentication token." },
        { status: 401 }
      );
    }
    const agentGate = requireAgentToken(ctx.agentId);
    if (agentGate) return agentGate;
    const tokenAgentId = ctx.agentId as string;

    const body = (await request.json().catch(() => null)) as {
      text?: unknown;
      clientMessageId?: unknown;
    } | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text || text.length > MAX_ACTIVITY_LENGTH) {
      return NextResponse.json(
        { success: false, error: `text must be 1 to ${MAX_ACTIVITY_LENGTH} characters` },
        { status: 400 }
      );
    }
    const clientMessageId =
      typeof body?.clientMessageId === "string" ? body.clientMessageId : "";
    if (!CLIENT_ID_PATTERN.test(clientMessageId)) {
      return NextResponse.json(
        { success: false, error: "clientMessageId must be 8 to 64 letters, digits, dashes or underscores" },
        { status: 400 }
      );
    }

    const agent = await prisma.agent.findFirst({
      where: { id: tokenAgentId, revokedAt: null },
      select: { id: true, userId: true },
    });
    if (!agent) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 }
      );
    }

    const contentScope = await chatContentScopeWhere({ userId: ctx.user.id, agentId: ctx.agentId, teamScope: ctx.teamScope });
    let session = await prisma.chatSession.findFirst({
      where: { userId: agent.userId, agentId: agent.id, ...contentScope },
      select: { id: true },
    });
    if (!session) {
      await prisma.chatSession.createMany({
        data: [{ userId: agent.userId, agentId: agent.id }],
        skipDuplicates: true,
      });
      session = await prisma.chatSession.findFirst({
        where: { userId: agent.userId, agentId: agent.id, ...contentScope },
        select: { id: true },
      });
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Session not found" },
          { status: 404 }
        );
      }
    }

    const messageId = `${ACTIVITY_ID_PREFIX}${tokenAgentId}-${clientMessageId}`;
    const sessionId = session.id;
    const persist = async (db: import("@prisma/client").Prisma.TransactionClient) => {
      if (ctx.teamScope != null) {
        await db.$queryRaw`SELECT id FROM "ChatSession" WHERE id = ${sessionId} FOR UPDATE`;
        if (!await db.chatSession.findFirst({ where: { id: sessionId, ...await chatContentScopeWhere({ userId: ctx.user.id, agentId: ctx.agentId, teamScope: ctx.teamScope }, db) }, select: { id: true } })) throw new TaskTeamScopeError();
      }
      const inserted = await db.chatMessage.createMany({
        data: [
          {
            id: messageId,
            sessionId: sessionId,
            content: text,
            role: "assistant",
            isDelivered: true,
            authorAgentId: tokenAgentId,
          },
        ],
        skipDuplicates: true,
      });

      if (inserted.count === 0) {
        const existing = await db.chatMessage.findUnique({
          where: { id: messageId },
          select: { sessionId: true },
        });
        if (existing?.sessionId !== sessionId) {
          return NextResponse.json(
            { success: false, error: "clientMessageId already used" },
            { status: 409 }
          );
        }
      }

      await db.chatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });
      return inserted;
    };
    const inserted = ctx.teamScope != null ? await prisma.$transaction(persist, { isolationLevel: 'Serializable' }) : await persist(prisma);
    if (inserted instanceof NextResponse) return inserted;
    await broadcastChatSession(session.id, [agent.userId]);

    return NextResponse.json({ success: true, duplicate: inserted.count === 0 });
  } catch (error: unknown) {
    if (error instanceof TaskTeamScopeError) return NextResponse.json({ success: false, error: error.message }, { status: 404 });
    console.error("[mcp chat] POST activity failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to add chat activity" },
      { status: 500 }
    );
  }

  })(request)
}
