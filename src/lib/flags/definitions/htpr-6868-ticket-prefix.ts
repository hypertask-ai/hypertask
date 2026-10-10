import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6868_TICKET_PREFIX_FLAG = "htpr-6868-ticket-prefix";

export default {
  key: HTPR_6868_TICKET_PREFIX_FLAG,
  kind: "feature",
  shippedOn: "2026-10-03",
  description: "Lets board editors change ticket prefixes and choose a prefix when creating a board, while old IDs keep resolving.",
  releaseRisk: {
    "risk": "new",
    "reason": "Board settings and board creation add ticket-prefix choices."
  },
} as const satisfies FeatureFlagDefinition;
