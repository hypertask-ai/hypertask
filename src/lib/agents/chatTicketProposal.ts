import { escapeHtml } from "@/utils/htmlEscape";

export const CHAT_PROPOSAL_MAX_TITLE = 255;
export const CHAT_PROPOSAL_MAX_OUTCOME = 4000;

export type ChatTicketProposalInput = {
  outcome: string;
  ticketTitle: string;
  targetProjectId: number;
  targetSectionId: number;
};

export function parseChatTicketProposal(raw: unknown): {
  proposal: ChatTicketProposalInput | null;
  error: string | null;
} {
  if (raw === undefined || raw === null) return { proposal: null, error: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { proposal: null, error: "proposal must be an object" };
  }
  const body = raw as Record<string, unknown>;
  const outcome = typeof body.outcome === "string" ? body.outcome.trim() : "";
  if (!outcome || outcome.length > CHAT_PROPOSAL_MAX_OUTCOME) {
    return {
      proposal: null,
      error: `proposal.outcome must be 1 to ${CHAT_PROPOSAL_MAX_OUTCOME} characters`,
    };
  }
  const ticketTitle =
    typeof body.ticketTitle === "string" ? body.ticketTitle.trim() : "";
  if (!ticketTitle || ticketTitle.length > CHAT_PROPOSAL_MAX_TITLE) {
    return {
      proposal: null,
      error: `proposal.ticketTitle must be 1 to ${CHAT_PROPOSAL_MAX_TITLE} characters`,
    };
  }
  const targetProjectId = Number(body.targetProjectId);
  const targetSectionId = Number(body.targetSectionId);
  if (!Number.isInteger(targetProjectId) || targetProjectId <= 0) {
    return { proposal: null, error: "proposal.targetProjectId must be a board id" };
  }
  if (!Number.isInteger(targetSectionId) || targetSectionId <= 0) {
    return { proposal: null, error: "proposal.targetSectionId must be a column id" };
  }
  return {
    proposal: { outcome, ticketTitle, targetProjectId, targetSectionId },
    error: null,
  };
}

export const chatTicketProposalSelect = {
  id: true,
  status: true,
  outcome: true,
  ticketTitle: true,
  targetProjectId: true,
  targetProjectTitle: true,
  targetSectionId: true,
  targetSectionTitle: true,
  failureMessage: true,
  taskId: true,
  task: {
    select: {
      ticketNumber: true,
      projectId: true,
      uniqueIndex: true,
      status: true,
    },
  },
} as const;

type ProposalRow = {
  id: string;
  status: string;
  outcome: string;
  ticketTitle: string;
  targetProjectTitle: string;
  targetSectionTitle: string;
  failureMessage: string | null;
  task?: {
    ticketNumber: string | null;
    projectId: number;
    uniqueIndex: number;
    status: string;
  } | null;
};

export type SerializedChatTicketProposal = {
  id: string;
  status: string;
  outcome: string;
  ticketTitle: string;
  targetProjectTitle: string;
  targetSectionTitle: string;
  failureMessage: string | null;
  task: { ticketNumber: string; url: string | null } | null;
};

export function serializeChatTicketProposal(
  row: ProposalRow | null | undefined,
): SerializedChatTicketProposal | null {
  if (!row) return null;
  const task = row.task?.ticketNumber
    ? {
        ticketNumber: row.task.ticketNumber,
        url:
          row.task.status === "Deleted"
            ? null
            : `/detail/project-${row.task.projectId}/${row.task.uniqueIndex}`,
      }
    : null;
  return {
    id: row.id,
    status: row.status,
    outcome: row.outcome,
    ticketTitle: row.ticketTitle,
    targetProjectTitle: row.targetProjectTitle,
    targetSectionTitle: row.targetSectionTitle,
    failureMessage: row.failureMessage ?? null,
    task,
  };
}

export const PROPOSAL_HEADING_PENDING = "Ticket proposed, nothing done yet";
export const PROPOSAL_HEADING_CREATED = "Ticket created";

export function proposalCardHeading(proposal: {
  status: string;
  task: { ticketNumber: string } | null;
}): string {
  if (proposal.status === "CONFIRMED" && proposal.task) {
    return PROPOSAL_HEADING_CREATED;
  }
  return PROPOSAL_HEADING_PENDING;
}

export function chatProposalDescriptionHtml(options: {
  outcome: string;
  agentName: string;
  agentRef: string;
}): string {
  const paragraphs = options.outcome
    .split(/\n{1,}/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
  const href = `/agents/chat?agent=${encodeURIComponent(options.agentRef)}`;
  return `${paragraphs}<p>Confirmed by the user in Agent Chat with <a href="${href}">${escapeHtml(
    options.agentName,
  )}</a>.</p>`;
}
