import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureChatParticipant,
  loadUserAgentChatSession,
} from "@/lib/agents/chatAccess";

export const runtime = "nodejs";

// Same cap as a message: a draft is a message that has not been sent yet.
const MAX_DRAFT_LENGTH = 8000;

// PATCH /api/agent-chat/[sessionId]/participant
// The caller's own private state in a shared thread: what they have typed but
// not sent, and how far they have read. Never anyone else's -- the row is
// keyed on the authenticated user, so a session id alone cannot reach it.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const userId = (await getSessionUser(request.headers))?.userId;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await params;
    const body = await request.json().catch(() => null);
    const hasDraft = body !== null && "draft" in body;
    const draft =
      typeof body?.draft === "string" ? body.draft : null;
    if (hasDraft && draft !== null && draft.length > MAX_DRAFT_LENGTH) {
      return NextResponse.json(
        { success: false, error: `Draft must be at most ${MAX_DRAFT_LENGTH} characters` },
        { status: 400 }
      );
    }
    const markRead = body?.read === true;
    if (!hasDraft && !markRead) {
      return NextResponse.json(
        { success: false, error: "Nothing to update" },
        { status: 400 }
      );
    }

    const access = await loadUserAgentChatSession({
      sessionId,
      userId,
      select: {},
    });
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status }
      );
    }

    await ensureChatParticipant(access.session.id, userId);
    const participant = await prisma.chatSessionParticipant.update({
      where: {
        sessionId_userId: { sessionId: access.session.id, userId },
      },
      data: {
        // Whitespace-only is no draft, so it clears the slot.
        ...(hasDraft
          ? { draft: draft && draft.trim() !== "" ? draft : null }
          : {}),
        // The server stamps the read marker instead of trusting a client
        // cursor, so it can only ever move forward.
        ...(markRead ? { lastReadAt: new Date() } : {}),
      },
      select: { draft: true, lastReadAt: true },
    });

    return NextResponse.json({ success: true, participant });
  } catch (error: any) {
    console.error("🚀 ~ PATCH ~ Error updating agent chat participant", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to update agent chat participant",
      },
      { status: 500 }
    );
  }
}
