import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8977_INDEXED_TICKET_LOOKUP_FLAG = "htpr-8977-indexed-ticket-lookup";

export default {
  key: HTPR_8977_INDEXED_TICKET_LOOKUP_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-11",
  description:
    "Finds ticket-number candidates with an indexed lower(ticketNumber) match instead of a case-insensitive scan of the whole Task table.",
  releaseRisk: {
    risk: "small",
    reason:
      "Same rows, same casing behaviour and same fallbacks; only the predicate the database plans on changes, so a lookup stops reading the whole Task table.",
  },
} as const satisfies FeatureFlagDefinition;
