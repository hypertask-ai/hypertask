import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7537_FIRST_COLUMN_PADDING_FLAG = "htpr-7537-first-column-padding";

export default {
  key: HTPR_7537_FIRST_COLUMN_PADDING_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description: "Restores the board's left padding when keyboard focus returns to the first column.",
  releaseRisk: {
    risk: "small",
    reason: "Only resets horizontal board scroll when keyboard navigation reaches the first column.",
  },
} as const satisfies FeatureFlagDefinition;
