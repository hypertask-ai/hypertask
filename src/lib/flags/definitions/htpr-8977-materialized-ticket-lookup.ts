import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8977_MATERIALIZED_TICKET_LOOKUP_FLAG = "htpr-8977-materialized-ticket-lookup";

export default {
  key: HTPR_8977_MATERIALIZED_TICKET_LOOKUP_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-14",
  description:
    "Matches the ticket number in a materialized step first, so the lower(ticketNumber) index is used even before the database has statistics for it.",
  releaseRisk: {
    risk: "small",
    reason:
      "Same rows, same order and same limit; only the query plan changes, and the flag restores the previous statement.",
  },
} as const satisfies FeatureFlagDefinition;
