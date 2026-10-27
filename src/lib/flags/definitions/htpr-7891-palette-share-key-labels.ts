import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7891_PALETTE_SHARE_KEY_LABELS_FLAG = "htpr-7891-palette-share-key-labels";

export default {
  key: HTPR_7891_PALETTE_SHARE_KEY_LABELS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "The command palette names the private copy-link keys ; like the help list and the Share Task tooltips.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes the two key labels the palette prints; Off keeps today's : labels.",
  },
} as const satisfies FeatureFlagDefinition;
