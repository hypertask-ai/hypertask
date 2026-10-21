import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureChatParticipant,
  loadUserAgentChatSession,
} from "@/lib/agents/chatAccess";

export const runtime = "nodejs";

const MAX_DRAFT_LENGTH = 8000;

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
    const hasDraft =
      typeof body === "object" && body !== null && "draft" in body;
    const draft = hasDraft ? (body as { draft: unknown }).draft : null;
    if (hasDraft && draft !== null && typeof draft !== "string") {
      return NextResponse.json(
        { success: false, error: "Draft must be text or null" },
        { status: 400 }
      );
    }
    if (typeof draft === "string" && draft.length > MAX_DRAFT_LENGTH) {
      return NextResponse.json(
        { success: false, error: `Draft must be at most ${MAX_DRAFT_LENGTH} characters` },
        { status: 400 }
      );
    }
    const nextDraft =
      typeof draft === "string" && draft.trim() !== "" ? draft : null;
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
    const where = { sessionId_userId: { sessionId: access.session.id, userId } };
    if (hasDraft) {
      await prisma.chatSessionParticipant.update({
        where,
        data: { draft: nextDraft },
        select: { id: true },
      });
    }
    if (markRead) {
      const now = new Date();
      await prisma.chatSessionParticipant.updateMany({
        where: {
          sessionId: access.session.id,
          userId,
          OR: [{ lastReadAt: null }, { lastReadAt: { lt: now } }],
        },
        data: { lastReadAt: now },
      });
    }
    const participant = await prisma.chatSessionParticipant.findUnique({
      where,
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
