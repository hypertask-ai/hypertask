import type { DockedChatScope } from "./useDockedChatScope";

export function isDockedChatTicketScope(scope: DockedChatScope, onTask: boolean, ticketScopeEnabled: boolean) {
  return onTask && (scope === "ticket" || (scope === null && !ticketScopeEnabled));
}
