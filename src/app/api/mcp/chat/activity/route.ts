import { NextRequest, NextResponse } from "next/server";
import { checkMcpRateLimit, validateMcpAuth } from "@/lib/mcp/auth";
import prisma from "@/lib/prisma";
import { MANAGER_LOOP_ACTIVITY_FLAG, isFeatureEnabled } from "@/lib/flags";
import { broadcastChatSession } from "@/lib/agents/chatBroadcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ACTIVITY_LENGTH = 2000;
// Deterministic, agent-scoped message id: one cron post per host tick, so a
// retried POST replays instead of duplicating. Client-supplied ids are never
// used raw (they would be a cross-session primary-key collision).
const ACTIVITY_ID_PREFIX = "loop-activity-";
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function requireAgentToken(ctxAgentId: string | null): NextResponse | null {
  if (ctxAgentId) return null;
  return NextResponse.json(
    { success: false, error: "Agent Chat activity requires an agent token" },
    { status: 403 }
  );
}

/**
 * POST /api/mcp/chat/activity
 *
 * An agent runtime posts an unsolicited activity entry into its own Agent Chat
 * thread — the scheduled Manager loop records every cycle here, including the
 * quiet and failed ones that never produce a reply. `clientMessageId` is the
 * idempotency key: the caller stamps it per cycle, so a retried POST returns
 * the already stored entry instead of creating a second one.
 */
export async function POST(request: NextRequest) {
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
    // Proven non-null by the gate above; the helper returns a response, not a
    // type predicate, so the narrowing has to be restated here.
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

    // The thread is keyed by the agent's owner, not by whoever could reach the
    // agent: sessions are unique per (userId, agentId), so only that row is
    // this agent's own conversation with its owner.
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

    // Flag gate before anything is stored (or an empty session is created);
    // the session owner is always the agent's owner, so one check covers both.
    if (!(await isFeatureEnabled(MANAGER_LOOP_ACTIVITY_FLAG, agent.userId))) {
      return NextResponse.json(
        { success: false, error: "Agent Chat activity is not enabled for this thread" },
        { status: 403 }
      );
    }

    let session = await prisma.chatSession.findFirst({
      where: { userId: agent.userId, agentId: agent.id },
      select: { id: true },
    });
    if (!session) {
      await prisma.chatSession.createMany({
        data: [{ userId: agent.userId, agentId: agent.id }],
        skipDuplicates: true,
      });
      session = await prisma.chatSession.findFirst({
        where: { userId: agent.userId, agentId: agent.id },
        select: { id: true },
      });
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Failed to open the agent chat session" },
          { status: 500 }
        );
      }
    }

    const messageId = `${ACTIVITY_ID_PREFIX}${tokenAgentId}-${clientMessageId}`;
    const inserted = await prisma.chatMessage.createMany({
      data: [
        {
          id: messageId,
          sessionId: session.id,
          content: text,
          role: "assistant",
          isDelivered: true,
          authorAgentId: tokenAgentId,
        },
      ],
      skipDuplicates: true,
    });

    if (inserted.count === 0) {
      const existing = await prisma.chatMessage.findUnique({
        where: { id: messageId },
        select: { sessionId: true },
      });
      if (existing?.sessionId !== session.id) {
        return NextResponse.json(
          { success: false, error: "clientMessageId already used" },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: true, duplicate: true });
    }

    await prisma.chatSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });
    await broadcastChatSession(session.id, [agent.userId]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[mcp chat] POST activity failed:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to add chat activity" },
      { status: 500 }
    );
  }
}
