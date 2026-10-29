import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { agentChatContextPayload } from "@/lib/agents/chatContext";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { resolveAgentTeamScope } from "@/lib/auth/agentTeamScope";
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
import { isFeatureEnabled } from "@/lib/flags";
import { AGENT_CHAT_ADHD_REPLY_GUIDANCE } from "@/lib/flags/keys";
import { hasFreshAgentChatHeartbeat } from "@/lib/agents/chatAvailability";
import { HTPR_7734_AGENT_CHAT_CONTEXT_FLAG } from "@/lib/flags/definitions/htpr-7734-agent-chat-context";
import { defaultContextSchema } from "@/lib/ai/chatStream/request";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

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
        agent: { select: { runtimeType: true, userId: true, credentialTeamId: true, credentialTeamAccessBinding: true } },
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

    let messageContext: Prisma.JsonObject | undefined;
    if (sidebarChatProjectId(request.headers) !== undefined && body?.default_context !== undefined &&
        await isFeatureEnabled(HTPR_7734_AGENT_CHAT_CONTEXT_FLAG, userId)) {
      const parsed = defaultContextSchema.safeParse(body.default_context);
      if (!parsed.success || (parsed.data.surface_path?.length ?? 0) > 500) {
        return NextResponse.json({ success: false, error: "Invalid chat context" }, { status: 400 });
      }
      const context = parsed.data;
      let recipientContextAccess: Prisma.ProjectWhereInput = {};
      if (context.project_id) {
        const notFound = { success: false, error: context.scope === "ticket" ? "Ticket not found" : "Board not found" };
        if (!session.agent) return NextResponse.json(notFound, { status: 404 });
        let teamScope;
        try {
          teamScope = await resolveAgentTeamScope(session.agent.userId, session.agent);
        } catch {
          return NextResponse.json(notFound, { status: 404 });
        }
        recipientContextAccess = projectContentAccessWhere(session.agent.userId, agentId, teamScope);
      }
      let selected: Prisma.JsonObject = { scope: "all" };
      if (context.scope === "ticket") {
        if (!context.task_id || !context.project_id) {
          return NextResponse.json({ success: false, error: "Ticket context requires a ticket and board" }, { status: 400 });
        }
        const task = await prisma.task.findFirst({
          where: {
            id: context.task_id,
            projectId: context.project_id,
            project: { AND: [projectContentAccessWhere(userId), recipientContextAccess] },
          },
          select: { id: true, projectId: true, ticketNumber: true, title: true },
        });
        if (!task) return NextResponse.json({ success: false, error: "Ticket not found" }, { status: 404 });
        selected = { scope: "ticket", task_id: task.id, project_id: task.projectId, ticket_number: task.ticketNumber, title: task.title };
      } else if (context.project_id) {
        const board = await prisma.project.findFirst({
          where: {
            id: context.project_id,
            AND: [projectContentAccessWhere(userId), recipientContextAccess],
          },
          select: { id: true, title: true },
        });
        if (!board) return NextResponse.json({ success: false, error: "Board not found" }, { status: 404 });
        selected = { scope: "board", project_id: board.id, title: board.title };
      }
      messageContext = { ...selected, ...(context.surface_path !== undefined ? { surface_path: context.surface_path } : {}) };
    }

    await ensureChatParticipant(session.id, userId);

    const sender = await prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    const senderName = sender?.displayName || "Hypertask user";

    let agentBrief: AgentWebhookChatBrief | null = null;
    try {
      agentBrief = await buildAgentChatBrief({ userId, agentId });
    } catch (error) {
      console.error("Failed to enrich Agent Chat with work context", error);
    }

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
          ...(messageContext ? { context: messageContext } : {}),
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
          ...(messageContext ? agentChatContextPayload(text, messageContext) : { text }),
          userName: sender?.displayName ?? null,
          replyGuidance: AGENT_CHAT_ADHD_REPLY_GUIDANCE,
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
