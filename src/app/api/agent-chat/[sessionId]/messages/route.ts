import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import {
  persistAgentRunTriggerWebhooks,
  publishAgentWebhookDeliveries,
} from "@/lib/agentWebhooks/outbox";
import { AGENT_CHAT_EVENT, broadcast, userChannel } from "@/lib/realtime/server";
import { NextRequest, NextResponse } from "next/server";
import { loadUserAgentChatSession } from "@/lib/agents/chatAccess";
import { buildAgentChatBrief } from "@/lib/agents/chatBrief";
import type { AgentWebhookChatBrief } from "@/lib/agentWebhooks/events";
import { AGENT_CHAT_BRIEF_FLAG, isFeatureEnabled } from "@/lib/flags";

export const runtime = "nodejs";

const MAX_MESSAGE_LENGTH = 8000;

// POST /api/agent-chat/[sessionId]/messages
// Store the human turn and, for an EXTERNAL agent, drop a chat.message
// webhook into the outbox in the same transaction so the agent runtime can
// run its turn and reply through the MCP endpoint.
export async function POST(
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
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text || text.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        {
          success: false,
          error: "Message must be 1 to 8000 characters",
        },
        { status: 400 }
      );
    }

    const access = await loadUserAgentChatSession({
      sessionId,
      userId,
      select: {
        user: { select: { displayName: true } },
        agent: { select: { runtimeType: true } },
      },
    });
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status }
      );
    }
    const session = access.session;
    const agentId = access.agentId;

    if (session.agent?.runtimeType === "NATIVE") {
      return NextResponse.json(
        { success: false, error: "Native agents use the AI chat" },
        { status: 400 }
      );
    }

    let agentBrief: AgentWebhookChatBrief | null = null;
    try {
      if (await isFeatureEnabled(AGENT_CHAT_BRIEF_FLAG, userId)) {
        agentBrief = await buildAgentChatBrief({ userId, agentId });
      }
    } catch (error) {
      console.error("Failed to enrich Agent Chat with work context", error);
    }

    const { message, deliveryIds } = await prisma.$transaction(async (tx) => {
      await tx.chatSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });
      const message = await tx.chatMessage.create({
        data: {
          sessionId: session.id,
          content: text,
          role: "human",
          isDelivered: true,
          authorUserId: userId,
        },
      });

      // The outbox row joins this transaction, so the webhook can never fire
      // for a message that failed to commit. An empty list means the agent has
      // no active subscription covering chat.message.
      const deliveryIds = await persistAgentRunTriggerWebhooks(tx, {
        event: "chat.message",
        agentId,
        projectId: null,
        taskId: null,
        ticketNumber: null,
        taskTitle: null,
        actor: {
          userId: userId,
          displayName: session.user.displayName || "Hypertask user",
        },
        chat: {
          sessionId: session.id,
          messageId: message.id,
          text,
          userName: session.user.displayName,
        },
        ...(agentBrief ? { agentBrief } : {}),
      });

      return { message, deliveryIds };
    });

    // Queue only after commit; a failure stays sweepable.
    await publishAgentWebhookDeliveries(deliveryIds);

    // Other tabs of this user refetch the thread; fire and forget.
    void broadcast(userChannel(userId), AGENT_CHAT_EVENT, {
      sessionId: session.id,
    });

    return NextResponse.json({
      success: true,
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      },
      delivered: deliveryIds.length > 0,
    });
  } catch (error: any) {
    console.error("🚀 ~ POST ~ Error adding agent chat message", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to add agent chat message",
      },
      { status: 500 }
    );
  }
}
