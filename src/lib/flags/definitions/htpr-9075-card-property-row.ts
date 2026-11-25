import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9075_CARD_PROPERTY_ROW_FLAG = "htpr-9075-card-property-row";

export default {
  key: HTPR_9075_CARD_PROPERTY_ROW_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-13",
  description: "Board cards stop reserving an empty row under the title when every card property is switched off in Card settings. A card with at least one property on looks the same as before.",
  related: ["htpr-8971-card-settings", "htpr-9026-card-people"],
  releaseRisk: {
    risk: "small",
    reason: "Only spacing inside your own board cards changes, and only when you have already switched every card property off.",
  },
} as const satisfies FeatureFlagDefinition;
