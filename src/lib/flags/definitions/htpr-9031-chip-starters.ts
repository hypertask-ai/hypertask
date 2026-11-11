import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9031_CHIP_STARTERS_FLAG = "htpr-9031-chip-starters";

export default {
  key: HTPR_9031_CHIP_STARTERS_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description:
    "Starter questions in a new AI chat sit bottom left just above the message box. Each question is only as wide as its text and uses the regular 14px chat font with 4px corners.",
  releaseRisk: {
    risk: "new",
    reason:
      "Visible UI change to the AI chat starter questions under design review. Off keeps the centered full-width 12px questions exactly as today.",
  },
} as const satisfies FeatureFlagDefinition;
