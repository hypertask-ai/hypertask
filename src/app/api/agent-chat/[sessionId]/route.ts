import prisma from "@/lib/prisma";
import { isValidUser } from "@/utils/edgeHelpers";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// GET /api/agent-chat/[sessionId]
// History for one agent chat session, oldest first. `awaiting` tells the
// client whether the ball is with the agent (last message is the human's).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");

    if (!userCookie?.value) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { isValid, user } = isValidUser(userCookie.value);

    if (!isValid || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await params;
    const session = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId: user.id, agentId: { not: null } },
      select: { id: true, agentId: true },
    });

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Session not found" },
        { status: 404 }
      );
    }

    // Last 200, oldest first: page desc from the tail, then flip.
    const messages = (
      await prisma.chatMessage.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: "desc" },
        take: 200,
      })
    ).reverse();

    const subscription = await prisma.agentWebhookSubscription.findUnique({
      where: { agentId: session.agentId! },
      select: { active: true, events: true },
    });
    const chatEnabled = Boolean(
      subscription?.active && subscription.events.includes("chat.message")
    );

    return NextResponse.json({
      success: true,
      session: { id: session.id, agentId: session.agentId },
      messages: messages.map(({ id, role, content, createdAt }) => ({
        id,
        role,
        content,
        createdAt,
      })),
      awaiting: messages[messages.length - 1]?.role === "human",
      chatEnabled,
    });
  } catch (error: any) {
    console.error("🚀 ~ GET ~ Error loading agent chat session", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to load agent chat session",
      },
      { status: 500 }
    );
  }
}
