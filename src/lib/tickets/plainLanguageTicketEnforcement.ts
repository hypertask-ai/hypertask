import {
  hasPlainLanguageTicketBlock,
  missingPlainLanguageTicketLabels,
  plainLanguageTicketRefusalMessage,
  isInternalAgentTicketBoard,
} from "./plainLanguageTicket";

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

export { hasPlainLanguageTicketBlock, plainLanguageTicketRefusalMessage, isInternalAgentTicketBoard };
