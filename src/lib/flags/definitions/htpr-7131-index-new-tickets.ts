import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7131_INDEX_NEW_TICKETS_FLAG = "htpr-7131-index-new-tickets";

export default {
  key: HTPR_7131_INDEX_NEW_TICKETS_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-11",
  releaseRisk: {
    "risk": "small",
    "reason": "New tickets use the existing search upsert after their description is saved; ticket data and access checks are unchanged.",
  },
  description: "Tickets created through the board, API or internal helpers appear in search without saving their title again.",
} as const satisfies FeatureFlagDefinition;
