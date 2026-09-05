import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { NextRequest, NextResponse } from "next/server";
import { accessibleAgentWhere } from "@/lib/agents/visibility";
import { listAgentChatActivity } from "@/lib/agents/agentChatActivity";
import { AGENT_CHAT_TICKET_CONFIRM_FLAG, isFeatureEnabled } from "@/lib/flags";
import {
  chatTicketProposalSelect,
  serializeChatTicketProposal,
} from "@/lib/agents/chatTicketProposal";

export const runtime = "nodejs";

// GET /api/agent-chat/[sessionId]
// History for one agent chat session, oldest first. `awaiting` tells the
// client whether the ball is with the agent (last message is the human's).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const userId = (await getSessionUser(request.headers))?.userId;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await params;
    const session = await prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId,
        agentId: { not: null },
        agent: {
          revokedAt: null,
          ...accessibleAgentWhere(userId),
        },
      },
      select: { id: true, agentId: true },
    });

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Session not found" },
        { status: 404 }
      );
    }

    const [activityRowsEnabled, ticketConfirmEnabled] = await Promise.all([
      isFeatureEnabled("htpr-6094-agent-activity-rows", userId),
      isFeatureEnabled(AGENT_CHAT_TICKET_CONFIRM_FLAG, userId),
    ]);
    // Last 200, oldest first: page desc from the tail, then flip.
    const [messageRows, activity] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: ticketConfirmEnabled
          ? { ticketProposal: { select: chatTicketProposalSelect } }
          : undefined,
      }),
      activityRowsEnabled
        ? listAgentChatActivity({
            agentId: session.agentId!,
            sessionId: session.id,
            userId,
          })
        : Promise.resolve([]),
    ]);
    const messages = messageRows.reverse();

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
      messages: messages.map(({ id, role, content, createdAt, ...rest }) => ({
        id,
        role,
        content,
        createdAt,
        proposal: serializeChatTicketProposal(
          (rest as { ticketProposal?: any }).ticketProposal,
        ),
      })),
      activity,
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
