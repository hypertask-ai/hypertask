import {
  hasPlainLanguageTicketBlock,
  missingPlainLanguageTicketLabels,
  plainLanguageTicketRefusalMessage,
  INTERNAL_AGENT_TICKET_BOARDS,
} from "./plainLanguageTicket.mjs";

export class PlainLanguageTicketError extends Error {
  constructor(readonly missing: string[]) {
    super(plainLanguageTicketRefusalMessage(missing));
  }
}

export function assertPlainLanguageTicketBlock(html: string | null | undefined): void {
  if (!hasPlainLanguageTicketBlock(html ?? "")) {
    throw new PlainLanguageTicketError(missingPlainLanguageTicketLabels(html ?? ""));
  }
}

export function isInternalAgentTicketBoard(projectId: number): boolean {
  return INTERNAL_AGENT_TICKET_BOARDS.has(projectId);
}

export { hasPlainLanguageTicketBlock, plainLanguageTicketRefusalMessage };
