import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9027_AMOLED_TOGGLE_FLAG = "htpr-9027-amoled-toggle";

export default {
  key: HTPR_9027_AMOLED_TOGGLE_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description: "In the AMOLED theme the toggle switch on-state uses the theme's cool grey accent instead of green.",
  related: ["htpr-8015-amoled-mode-outline"],
  releaseRisk: {
    risk: "small",
    reason: "Only changes the on-state colour of existing toggle switches in AMOLED. Other themes, the off state and behaviour stay the same, and Off restores the green.",
  },
} as const satisfies FeatureFlagDefinition;
