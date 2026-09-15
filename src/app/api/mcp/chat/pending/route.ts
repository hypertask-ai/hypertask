import { NextRequest, NextResponse } from "next/server";
import { checkMcpRateLimit, validateMcpAuth } from "@/lib/mcp/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CANDIDATE_LIMIT = 100;
const PENDING_LIMIT = 20;

/**
 * GET /api/mcp/chat/pending
 *
 * A poll is the external runtime's chat heartbeat and returns its unanswered
 * human turns. The agent token scopes both the heartbeat and every message.
 */
export async function GET(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;
    const ctx = await validateMcpAuth(request);
    if (!ctx?.agentId) {
      return NextResponse.json(
        { success: false, error: "Agent Chat polling requires an agent token" },
        { status: 401 },
      );
    }

    const heartbeatAt = new Date();
    const heartbeat = await prisma.agent.updateMany({
      where: { id: ctx.agentId, revokedAt: null },
      data: { heartbeatAt },
    });
    if (heartbeat.count === 0) {
      return NextResponse.json(
        { success: false, error: "Agent not found" },
        { status: 404 },
      );
    }

    const candidates = await prisma.chatMessage.findMany({
      where: { role: "human", session: { agentId: ctx.agentId } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: CANDIDATE_LIMIT,
      select: {
        id: true,
        sessionId: true,
        content: true,
        createdAt: true,
        authorUser: { select: { displayName: true } },
      },
    });
    const replies = candidates.length
      ? await prisma.chatMessage.findMany({
          where: { replyToMessageId: { in: candidates.map(({ id }) => id) } },
          select: { replyToMessageId: true },
        })
      : [];
    const answered = new Set(
      replies.flatMap(({ replyToMessageId }) =>
        replyToMessageId ? [replyToMessageId] : [],
      ),
    );
    const messages = candidates
      .filter(({ id }) => !answered.has(id))
      .slice(0, PENDING_LIMIT)
      .reverse()
      .map((message) => ({
        id: message.id,
        sessionId: message.sessionId,
        text: message.content,
        userName: message.authorUser?.displayName ?? null,
        createdAt: message.createdAt,
      }));

    return NextResponse.json({ success: true, heartbeatAt, messages });
  } catch (error) {
    console.error("[mcp chat] GET pending failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to poll Agent Chat" },
      { status: 500 },
    );
  }
}
