import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureChatParticipant,
  loadUserAgentChatSession,
  sidebarChatProjectId,
} from "@/lib/agents/chatAccess";
import { listAgentChatActivity } from "@/lib/agents/agentChatActivity";
import { isFeatureEnabled } from "@/lib/flags";
import {
  chatTicketProposalSelect,
  serializeChatTicketProposal,
} from "@/lib/agents/chatTicketProposal";
import {
  AGENT_CHAT_PARKED_MESSAGE,
  isAgentChatSystemMessage,
} from "@/lib/agentRuns/model";
import { readAgentChatTurn } from "@/lib/agentRuns/service";
import { agentChatDeliveryMode } from "@/lib/agents/chatAvailability";
import { HTPR_7734_AGENT_CHAT_CONTEXT_FLAG } from "@/lib/flags/definitions/htpr-7734-agent-chat-context";

export const runtime = "nodejs";

const PARKED_NOTICE_WHERE: Prisma.ChatMessageWhereInput = {
  role: "assistant",
  isDelivered: false,
  content: AGENT_CHAT_PARKED_MESSAGE,
};

const MAX_HISTORY_PAGE = 200;

function unreadSince(
  sessionId: string,
  userId: number,
  since: Date,
) {
  return prisma.chatMessage.count({
    where: {
      sessionId,
      createdAt: { gt: since },
      NOT: PARKED_NOTICE_WHERE,
      OR: [{ authorUserId: null }, { authorUserId: { not: userId } }],
    },
  });
}

function sentContextIds(context: Prisma.JsonValue | null) {
  if (!context || typeof context !== "object" || Array.isArray(context)) return {};
  const { scope, project_id, task_id } = context as Prisma.JsonObject;
  return { context: { scope, project_id, task_id } };
}

export async function GET(
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
    const access = await loadUserAgentChatSession({
      sessionId,
      userId,
      sidebarProjectId: sidebarChatProjectId(request.headers),
      actingAgentId: sessionUser?.agentId,
      select: { agent: { select: { heartbeatAt: true } } },
    });
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status }
      );
    }
    const session = access.session;

    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit"));
    const limit =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, MAX_HISTORY_PAGE)
        : MAX_HISTORY_PAGE;
    const before = url.searchParams.get("before");
    if (before) {
      const cursor = await prisma.chatMessage.findFirst({
        where: { id: before, sessionId: session.id },
        select: { id: true },
      });
      if (!cursor) {
        return NextResponse.json(
          { success: false, error: "before is not a message in this session" },
          { status: 400 }
        );
      }
    }

    const activityRowsEnabled = sidebarChatProjectId(request.headers) === undefined;
    const contextEnabled = await isFeatureEnabled(
      HTPR_7734_AGENT_CHAT_CONTEXT_FLAG,
      userId,
    );
    await readAgentChatTurn(
      { userId, agentId: null, displayName: "Hypertask user", source: "browser" },
      session.id,
    ).catch((error) => console.warn("[agent-chat] turn reconcile failed", session.id, error));
    const [pageRows, activity] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { sessionId: session.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(before ? { cursor: { id: before }, skip: 1 } : {}),
        include: { ticketProposal: { select: chatTicketProposalSelect } },
      }),
      activityRowsEnabled && !before
        ? listAgentChatActivity({
            agentId: access.agentId,
            sessionId: session.id,
            userId,
          })
        : Promise.resolve([]),
    ]);
    const hasMore = pageRows.length > limit;
    const messageRows = hasMore ? pageRows.slice(0, limit) : pageRows;
    const messages = messageRows
      .reverse()
      .filter(
        (message) =>
          !(isAgentChatSystemMessage(message) &&
            message.content === AGENT_CHAT_PARKED_MESSAGE),
      );

    const participant = before
      ? null
      : await ensureChatParticipant(session.id, userId);
    const [unreadCount, participants, subscription] = await Promise.all([
      participant
        ? unreadSince(
            session.id,
            userId,
            participant.lastReadAt ?? participant.joinedAt,
          )
        : null,
      before
        ? null
        : prisma.chatSessionParticipant.findMany({
            where: { sessionId: session.id },
            orderBy: { joinedAt: "asc" },
            select: {
              userId: true,
              joinedAt: true,
              user: { select: { displayName: true, email: true } },
            },
          }),
      prisma.agentWebhookSubscription.findUnique({
        where: { agentId: access.agentId },
        select: { active: true, events: true },
      }),
    ]);
    const viewer = participant
      ? { draft: participant.draft, unreadCount: unreadCount ?? 0 }
      : null;
    const deliveryMode = agentChatDeliveryMode({
      heartbeatAt: session.agent?.heartbeatAt ?? null,
      subscription,
    });

    return NextResponse.json({
      success: true,
      session: { id: session.id, agentId: session.agentId },
      messages: messages.map((message) => ({
        id: message.id,
        role: isAgentChatSystemMessage(message) ? "system" : message.role,
        content: message.content,
        createdAt: message.createdAt,
        ...(contextEnabled ? sentContextIds(message.context) : {}),
      })).map((message, index) => ({
        ...message,
        proposal: serializeChatTicketProposal(
          (messages[index] as { ticketProposal?: any }).ticketProposal,
        ),
      })),
      activity: before ? null : activity,
      hasMore,
      nextBefore: hasMore ? (messages[0]?.id ?? null) : null,
      awaiting: before ? null : messages[messages.length - 1]?.role === "human",
      viewer,
      participants:
        participants?.map((participant) => ({
          userId: participant.userId,
          displayName:
            participant.user.displayName || participant.user.email,
          joinedAt: participant.joinedAt,
        })) ?? null,
      sharedConversationEnabled: true,
      chatEnabled: deliveryMode !== null,
      deliveryMode,
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
