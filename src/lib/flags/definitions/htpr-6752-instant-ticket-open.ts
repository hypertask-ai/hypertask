import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6752_INSTANT_TICKET_OPEN_FLAG = "htpr-6752-instant-ticket-open";

export default {
  key: HTPR_6752_INSTANT_TICKET_OPEN_FLAG,
  shippedOn: "2026-10-02",
  description:
    "Shows a ticket immediately from authorized cached board, My Tasks, or Inbox data while its full detail refreshes in the background.",
} as const satisfies FeatureFlagDefinition;
