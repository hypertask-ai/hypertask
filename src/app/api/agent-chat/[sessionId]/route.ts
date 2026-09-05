import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { NextRequest, NextResponse } from "next/server";
import { loadUserAgentChatSession } from "@/lib/agents/chatAccess";
import { listAgentChatActivity } from "@/lib/agents/agentChatActivity";
import { isFeatureEnabled } from "@/lib/flags";
import { AGENT_CHAT_TICKET_CONFIRM_FLAG } from "@/lib/flags";
import {
  chatTicketProposalSelect,
  serializeChatTicketProposal,
} from "@/lib/agents/chatTicketProposal";

export const runtime = "nodejs";

// History page size, and the cap on ?limit=. Unchanged default so a client
// that does not page keeps getting exactly what it got before.
const MAX_HISTORY_PAGE = 200;

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
    const session = access.session;

    // Paging walks backwards from the newest message. `before` is the oldest
    // id the client already holds, so the next page ends just above it.
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

    const activityRowsEnabled = await isFeatureEnabled(
      "htpr-6094-agent-activity-rows",
      userId,
    );
    const ticketConfirmEnabled = await isFeatureEnabled(
      AGENT_CHAT_TICKET_CONFIRM_FLAG,
      userId,
    );
    // One page, oldest first: read desc from the tail, then flip. createdAt
    // alone ties for messages stored in the same millisecond, so id breaks the
    // tie and a page boundary lands in the same place on every request.
    const [pageRows, activity] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { sessionId: session.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(before ? { cursor: { id: before }, skip: 1 } : {}),
        include: ticketConfirmEnabled
          ? { ticketProposal: { select: chatTicketProposalSelect } }
          : undefined,
      }),
      activityRowsEnabled
        ? listAgentChatActivity({
            agentId: access.agentId,
            sessionId: session.id,
            userId,
          })
        : Promise.resolve([]),
    ]);
    // One row over the page size is the has-more probe; it is not returned.
    const hasMore = pageRows.length > limit;
    const messageRows = hasMore ? pageRows.slice(0, limit) : pageRows;
    const messages = messageRows.reverse();

    const subscription = await prisma.agentWebhookSubscription.findUnique({
      where: { agentId: access.agentId },
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
      // Second pass over the same array, so index i is the same row in both.
      })).map((message, index) => ({
        ...message,
        proposal: serializeChatTicketProposal(
          (messages[index] as { ticketProposal?: any }).ticketProposal,
        ),
      })),
      activity,
      hasMore,
      // The id to send back as `before` for the page above this one.
      nextBefore: hasMore ? (messages[0]?.id ?? null) : null,
      // Null on a paged read: an older page's last row says nothing about
      // whose turn it is, and guessing "not waiting" would clear a live
      // thinking state in the client.
      awaiting: before ? null : messages[messages.length - 1]?.role === "human",
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
