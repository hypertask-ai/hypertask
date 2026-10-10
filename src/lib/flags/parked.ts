/**
 * Flags parked while the Paperclip decision (HTPR-7059) is open. The one-file-per-flag
 * definitions cannot carry a parked field, so the list lives here and the flags page reads it.
 */
export const PARKED_FLAG_REASON = "Waiting on the Paperclip decision (HTPR-7059)";

const PARKED_FLAG_NAMES = [
  "htpr-6002-shared-agent-chat",
  "htpr-6006-chat-confirm-ticket",
  "htpr-6094-agent-activity-rows",
  "htpr-6154-chat-stop-and-timeout",
  "htpr-6155-chat-agent-brief",
  "htpr-6197-confirmed-proposal-heading",
  "htpr-6243-manager-loop-activity",
  "htpr-6283-agent-chat-live-sort",
  "htpr-6284-agent-mention-routing",
  "htpr-6287-agent-chat-roster-status",
  "htpr-6407-mobile-agent-chat-layout",
  "htpr-6476-mobile-agent-chat-fullscreen",
  "htpr-6512-seed-team-agent",
  "htpr-6553-agent-chat-polling",
  "htpr-6557-agent-rooms",
] as const;

export const PARKED_FLAGS: Readonly<Record<string, { reason: string }>> = Object.fromEntries(
  PARKED_FLAG_NAMES.map((name) => [name, { reason: PARKED_FLAG_REASON }]),
);
