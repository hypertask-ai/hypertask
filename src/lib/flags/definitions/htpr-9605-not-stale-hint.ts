import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9605_NOT_STALE_HINT_FLAG = "htpr-9605-not-stale-hint";

export default {
  key: HTPR_9605_NOT_STALE_HINT_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-23",
  description:
    "The Not stale filter says what it hides: no comment and no column move in the board's warn days hides a card.",
  releaseRisk: {
    risk: "small",
    reason:
      "Adds one muted line under the Not stale filter row. Filtering and every other row stay the same, and Off removes the line.",
  },
} as const satisfies FeatureFlagDefinition;
