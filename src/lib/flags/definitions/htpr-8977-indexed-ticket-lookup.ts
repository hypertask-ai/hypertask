import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8977_INDEXED_TICKET_LOOKUP_FLAG = "htpr-8977-indexed-ticket-lookup";

export default {
  key: HTPR_8977_INDEXED_TICKET_LOOKUP_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-11",
  description:
    "Resolves a ticket number with an indexed exact match before the case-insensitive query, so the task lookup stops scanning the whole Task table.",
  releaseRisk: {
    risk: "small",
    reason:
      "Same rows and same fallbacks; only the predicate the database plans on changes, so a lookup costs 15 buffers instead of 37103.",
  },
} as const satisfies FeatureFlagDefinition;
