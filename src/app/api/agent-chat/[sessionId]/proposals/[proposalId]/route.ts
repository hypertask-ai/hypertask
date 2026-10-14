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

const CONFIRM_LEASE_MS = 60_000;

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
      return NextResponse.json({
        success: true,
        proposal: serializeChatTicketProposal(proposal),
      });
    }

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

    const attached = await prisma.chatTicketProposal.updateMany({
      where: { id: proposal.id, taskId: null },
      data: { taskId: task.id },
    });
    if (attached.count === 0) {
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
