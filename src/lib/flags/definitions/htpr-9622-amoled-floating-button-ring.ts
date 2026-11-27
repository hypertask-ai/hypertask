import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9622_AMOLED_FLOATING_BUTTON_RING_FLAG = "htpr-9622-amoled-floating-button-ring";

export default {
  key: HTPR_9622_AMOLED_FLOATING_BUTTON_RING_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-23",
  description:
    "The phone AI and new-task buttons in the AMOLED theme use the theme's hairline colour instead of a bright grey ring.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only changes the ring colour of the two floating phone buttons in the AMOLED theme. Other themes, and the buttons' size and position, stay the same, and Off restores the previous ring.",
  },
} as const satisfies FeatureFlagDefinition;
