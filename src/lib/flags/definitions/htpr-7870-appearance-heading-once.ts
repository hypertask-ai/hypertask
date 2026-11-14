import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7870_APPEARANCE_HEADING_ONCE_FLAG = "htpr-7870-appearance-heading-once";

export default {
  key: HTPR_7870_APPEARANCE_HEADING_ONCE_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-09",
  description:
    "Settings, Appearance shows the word Appearance once at the top of the page instead of repeating it on the card above the theme list.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only removes a repeated label above the theme list on desktop. Every theme choice works the same, and Off restores the second label.",
  },
} as const satisfies FeatureFlagDefinition;
