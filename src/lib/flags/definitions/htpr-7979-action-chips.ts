import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7979_ACTION_CHIPS_FLAG = "htpr-7979-action-chips";

export default {
  key: HTPR_7979_ACTION_CHIPS_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-30",
  description: "After Ctrl+J creates a ticket, the chips under it are up to three one-tap next actions or open decisions that read the original note and the board rules. No chips when nothing fits.",
  related: ["htpr-7534-writing-questions", "htpr-7978-ai-chip-events"],
  releaseRisk: {
    risk: "new",
    reason: "Replaces the new-ticket chip prompt for the people it is on for and sends the original note to the chip route; switching it off restores the writing chips.",
  },
} as const satisfies FeatureFlagDefinition;
