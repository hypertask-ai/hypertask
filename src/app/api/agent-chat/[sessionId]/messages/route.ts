import prisma from "@/lib/prisma";
import { isValidUser } from "@/utils/edgeHelpers";
import {
  persistAgentWebhookEvent,
  publishAgentWebhookDeliveries,
} from "@/lib/agentWebhooks/outbox";
import { AGENT_CHAT_EVENT, broadcast, userChannel } from "@/lib/realtime/server";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

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

    const session = await prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId: user.id,
        agentId: { not: null },
        agent: { revokedAt: null },
      },
      select: {
        id: true,
        agentId: true,
        user: { select: { displayName: true } },
        agent: { select: { runtimeType: true } },
      },
    });

    if (!session || !session.agentId) {
      return NextResponse.json(
        { success: false, error: "Session not found" },
        { status: 404 }
      );
    }
    const agentId = session.agentId;

    if (session.agent?.runtimeType === "NATIVE") {
      return NextResponse.json(
        { success: false, error: "Native agents use the AI chat" },
        { status: 400 }
      );
    }

    const { message, deliveryId } = await prisma.$transaction(async (tx) => {
      const message = await tx.chatMessage.create({
        data: {
          sessionId: session.id,
          content: text,
          role: "human",
          isDelivered: true,
        },
      });

      // The outbox row joins this transaction, so the webhook can never fire
      // for a message that failed to commit. A null id means the agent has no
      // active subscription covering chat.message.
      const deliveryId = await persistAgentWebhookEvent(tx, {
        event: "chat.message",
        agentId,
        projectId: null,
        taskId: null,
        ticketNumber: null,
        taskTitle: null,
        actor: {
          userId: user.id,
          displayName: session.user.displayName || "Hypertask user",
        },
        chat: {
          sessionId: session.id,
          messageId: message.id,
          text,
          userName: session.user.displayName,
        },
      });

      await tx.chatSession.update({
        where: { id: session.id },
        data: { updatedAt: new Date() },
      });

      return { message, deliveryId };
    });

    // Queue only after commit; a failure stays sweepable.
    await publishAgentWebhookDeliveries([deliveryId]);

    // Other tabs of this user refetch the thread; fire and forget.
    void broadcast(userChannel(user.id), AGENT_CHAT_EVENT, {
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
      delivered: deliveryId !== null,
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
