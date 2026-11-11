import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9026_CARD_PEOPLE_FLAG = "htpr-9026-card-people";

export default {
  key: HTPR_9026_CARD_PEOPLE_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-11",
  description: "Card settings lets you hide People on board cards. Names stay visible without a disabled switch. Existing People visibility stays unchanged until you switch it off.",
  releaseRisk: {
    risk: "small",
    reason: "Only your own board card appearance changes. Assignments stay saved and People can be shown again.",
  },
} as const satisfies FeatureFlagDefinition;
