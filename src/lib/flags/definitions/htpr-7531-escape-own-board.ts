import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7531_ESCAPE_OWN_BOARD_FLAG = "htpr-7531-escape-own-board";

export default {
  key: HTPR_7531_ESCAPE_OWN_BOARD_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description: "Escape and the ticket back arrow return to the ticket's own board when the previous board URL is missing its ID or points at another board.",
  releaseRisk: {
    risk: "small",
    reason: "Only ambiguous or different-board history targets use the ticket's board; search, inbox and explicit same-board history returns stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
