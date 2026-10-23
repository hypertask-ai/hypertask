import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import {
  persistAgentRunTriggerWebhooks,
  publishAgentWebhookDeliveries,
} from "@/lib/agentWebhooks/outbox";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureChatParticipant,
  loadUserAgentChatSession,
  sidebarChatProjectId,
} from "@/lib/agents/chatAccess";
import { broadcastChatSession } from "@/lib/agents/chatBroadcast";
import { buildAgentChatBrief } from "@/lib/agents/chatBrief";
import type { AgentWebhookChatBrief } from "@/lib/agentWebhooks/events";
import { AGENT_CHAT_BRIEF_FLAG, isFeatureEnabled } from "@/lib/flags";
import {
  AGENT_CHAT_ADHD_REPLY_GUIDANCE,
  HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG,
} from "@/lib/flags/keys";
import { hasFreshAgentChatHeartbeat } from "@/lib/agents/chatAvailability";

export const runtime = "nodejs";

const MAX_MESSAGE_LENGTH = 8000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const sessionUser = await getSessionUser(request.headers);
    const userId = sessionUser?.userId;
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
      sidebarProjectId: sidebarChatProjectId(request.headers),
      actingAgentId: sessionUser?.agentId,
      select: {
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

    await ensureChatParticipant(session.id, userId);

    const sender = await prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    const senderName = sender?.displayName || "Hypertask user";

    let agentBrief: AgentWebhookChatBrief | null = null;
    try {
      if (await isFeatureEnabled(AGENT_CHAT_BRIEF_FLAG, userId)) {
        agentBrief = await buildAgentChatBrief({ userId, agentId });
      }
    } catch (error) {
      console.error("Failed to enrich Agent Chat with work context", error);
    }

    const adhdReplyEnabled = await isFeatureEnabled(
      HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG,
      userId,
    );

    const { message, deliveryIds, pollingChatEnabled } =
      await prisma.$transaction(async (tx) => {
      const [agent] = await tx.$queryRaw<Array<{ heartbeatAt: Date | null }>>`
        SELECT "heartbeatAt"
        FROM "Agent"
        WHERE "id" = ${agentId}
          AND "revokedAt" IS NULL
        FOR UPDATE
      `;
      if (!agent) throw new Error("Agent not found");
      const subscription = await tx.agentWebhookSubscription.findUnique({
        where: { agentId },
        select: { active: true },
      });
      const pollingChatEnabled =
        !subscription?.active &&
        hasFreshAgentChatHeartbeat(agent.heartbeatAt);

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
      await tx.chatSessionParticipant.updateMany({
        where: { sessionId: session.id, userId },
        data: { draft: null, lastReadAt: message.createdAt },
      });

      const deliveryIds = await persistAgentRunTriggerWebhooks(tx, {
        event: "chat.message",
        agentId,
        projectId: null,
        taskId: null,
        ticketNumber: null,
        taskTitle: null,
        actor: {
          userId: userId,
          displayName: senderName,
        },
        chat: {
          sessionId: session.id,
          messageId: message.id,
          text,
          userName: sender?.displayName ?? null,
          ...(adhdReplyEnabled
            ? { replyGuidance: AGENT_CHAT_ADHD_REPLY_GUIDANCE }
            : {}),
        },
        ...(agentBrief ? { agentBrief } : {}),
      });

      if (deliveryIds.length === 0 && pollingChatEnabled) {
        await tx.chatMessage.update({
          where: { id: message.id },
          data: { isDelivered: false },
        });
      }

      return { message, deliveryIds, pollingChatEnabled };
    });

    await publishAgentWebhookDeliveries(deliveryIds);

    await broadcastChatSession(session.id, [userId]);

    return NextResponse.json({
      success: true,
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      },
      delivered: deliveryIds.length > 0 || pollingChatEnabled,
      notice: null,
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
