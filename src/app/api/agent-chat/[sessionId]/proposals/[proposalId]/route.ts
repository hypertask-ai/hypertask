import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { NextRequest, NextResponse } from "next/server";
import { loadUserAgentChatSession } from "@/lib/agents/chatAccess";
import { AGENT_CHAT_TICKET_CONFIRM_FLAG, isFeatureEnabled } from "@/lib/flags";
import { AGENT_CHAT_EVENT, broadcast, userChannel } from "@/lib/realtime/server";
import { getAgentRole } from "@/lib/mcp/agents/scopes";
import { getSectionForTask, validateProjectAccess } from "@/lib/mcp/tasks/services";
import { createTaskCore } from "@/utils/controllers/tasks/createTaskCore";
import {
  chatProposalDescriptionHtml,
  chatTicketProposalSelect,
  serializeChatTicketProposal,
} from "@/lib/agents/chatTicketProposal";

export const runtime = "nodejs";

// A confirm that dies mid-flight (timeout, redeploy) leaves CONFIRMED with no
// task. After this long another confirm may take it over; below it, a second
// click is a duplicate and must not create a second ticket.
// ponytail: fixed 60s lease. Swap for a claim token if confirms ever run longer.
const CONFIRM_LEASE_MS = 60_000;

/**
 * POST /api/agent-chat/[sessionId]/proposals/[proposalId]
 *
 * The confirmation boundary. `confirm` creates exactly one board ticket for a
 * proposal the agent made in chat; `dismiss` keeps the conversation going and
 * creates nothing. Every right is rechecked here, live: the proposal's stored
 * board and column are ids to verify, never permission to act.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; proposalId: string }> }
) {
  try {
    const userId = (await getSessionUser(request.headers))?.userId;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId, proposalId } = await params;
    const body = await request.json().catch(() => null);
    const action = body?.action;
    if (action !== "confirm" && action !== "dismiss") {
      return NextResponse.json(
        { success: false, error: "action must be confirm or dismiss" },
        { status: 400 }
      );
    }

    if (!(await isFeatureEnabled(AGENT_CHAT_TICKET_CONFIRM_FLAG, userId))) {
      return NextResponse.json(
        { success: false, error: "Ticket confirmation is not enabled" },
        { status: 403 }
      );
    }

    const access = await loadUserAgentChatSession({
      sessionId,
      userId,
      select: { agent: { select: { id: true, displayName: true } } },
    });
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status }
      );
    }
    const session = access.session;
    if (!session.agent) {
      return NextResponse.json(
        { success: false, error: "Session not found" },
        { status: 404 }
      );
    }
    const agentId = access.agentId;

    const proposal = await prisma.chatTicketProposal.findFirst({
      where: { id: proposalId, message: { sessionId: session.id } },
      select: chatTicketProposalSelect,
    });
    if (!proposal) {
      return NextResponse.json(
        { success: false, error: "Proposal not found" },
        { status: 404 }
      );
    }

    const notifyOtherTabs = () => {
      void broadcast(userChannel(userId), AGENT_CHAT_EVENT, {
        sessionId: session.id,
      });
    };
    const reread = async () =>
      prisma.chatTicketProposal.findUnique({
        where: { id: proposal.id },
        select: chatTicketProposalSelect,
      });
    const fail = async (message: string, status: number) => {
      // Only the claim this request holds may be released. An unguarded write
      // would reopen a proposal a second tab dismissed, or wipe the ticket off
      // one that finished while these live rechecks were still running.
      await prisma.chatTicketProposal.updateMany({
        where: { id: proposal.id, status: "CONFIRMED", taskId: null },
        data: {
          status: "FAILED",
          failureMessage: message.slice(0, 255),
          failedAt: new Date(),
        },
      });
      notifyOtherTabs();
      return NextResponse.json(
        {
          success: false,
          error: message,
          proposal: serializeChatTicketProposal(await reread()),
        },
        { status }
      );
    };

    if (action === "dismiss") {
      await prisma.chatTicketProposal.updateMany({
        where: { id: proposal.id, status: { in: ["PENDING", "FAILED"] } },
        data: { status: "DISMISSED", dismissedAt: new Date() },
      });
      notifyOtherTabs();
      return NextResponse.json({
        success: true,
        proposal: serializeChatTicketProposal(await reread()),
      });
    }

    if (proposal.status === "DISMISSED") {
      return NextResponse.json(
        {
          success: false,
          error: "This proposal was dismissed",
          proposal: serializeChatTicketProposal(proposal),
        },
        { status: 409 }
      );
    }
    if (proposal.status === "CONFIRMED" && proposal.taskId) {
      // Already done: the second click returns the same ticket.
      return NextResponse.json({
        success: true,
        proposal: serializeChatTicketProposal(proposal),
      });
    }

    // One conditional write decides who creates the ticket. A losing click
    // matches no row and returns the winner's state instead of creating a second.
    const claimed = await prisma.chatTicketProposal.updateMany({
      where: {
        id: proposal.id,
        OR: [
          { status: { in: ["PENDING", "FAILED"] } },
          {
            status: "CONFIRMED",
            taskId: null,
            confirmedAt: { lt: new Date(Date.now() - CONFIRM_LEASE_MS) },
          },
        ],
      },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        failureMessage: null,
        failedAt: null,
      },
    });
    if (claimed.count === 0) {
      return NextResponse.json({
        success: true,
        proposal: serializeChatTicketProposal(await reread()),
      });
    }

    // Rights are rechecked now, not trusted from when the agent proposed: board
    // access can be revoked and the agent's role narrowed in between.
    const projectCheck = await validateProjectAccess(
      proposal.targetProjectId,
      userId,
      agentId
    );
    if (projectCheck.error) {
      return fail(projectCheck.error.message, projectCheck.error.status);
    }
    if (!projectCheck.project.uniqueIdentifier) {
      return fail("This board cannot create numbered tickets", 400);
    }
    if ((await getAgentRole({ agentId })) === "read") {
      return fail("This agent may only read, so it cannot create tickets", 403);
    }
    const sectionCheck = await getSectionForTask(
      proposal.targetProjectId,
      proposal.targetSectionId
    );
    if (sectionCheck.error) {
      return fail(sectionCheck.error.message, sectionCheck.error.status);
    }

    let task;
    try {
      const created = await createTaskCore({
        title: proposal.ticketTitle,
        description: chatProposalDescriptionHtml({
          outcome: proposal.outcome,
          agentName: session.agent.displayName,
          agentRef: session.agent.id,
        }),
        userId,
        projectId: projectCheck.project.id,
        sectionId: sectionCheck.section.id,
        sectionTitle: sectionCheck.section.section_title,
        projectIdentifier: projectCheck.project.uniqueIdentifier,
      });
      task = created.task;
    } catch (error: any) {
      console.error("[agent-chat] confirm failed to create the ticket", error);
      return fail(error?.message || "Could not create the ticket", 500);
    }

    // taskId is unique and only attaches while it is null, so a lease takeover
    // that raced the original confirm cannot leave two tickets on the board.
    // ponytail: the create and this attach are two statements, so a process
    // that dies between them leaves one ticket no proposal points at, and the
    // lease takeover then creates a second. Recording the ticket id before the
    // create (or creating it in the same transaction) closes that window.
    const attached = await prisma.chatTicketProposal.updateMany({
      where: { id: proposal.id, taskId: null },
      data: { taskId: task.id },
    });
    if (attached.count === 0) {
      // ponytail: a plain status write rather than the archive controller, so
      // this skips the activity row and notifications. Fine for a ticket the
      // board never should have seen; use updateTaskSingle if that changes.
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "Archive", archivedAt: new Date() },
      });
    }

    notifyOtherTabs();
    return NextResponse.json({
      success: true,
      proposal: serializeChatTicketProposal(await reread()),
    });
  } catch (error: any) {
    console.error("🚀 ~ POST ~ Error confirming chat ticket proposal", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to update the proposal",
      },
      { status: 500 }
    );
  }
}
