import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7695_COLUMN_REVEAL_AHEAD_FLAG = "htpr-7695-column-reveal-ahead";

export default {
  key: HTPR_7695_COLUMN_REVEAL_AHEAD_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-24",
  defaultMode: "EVERYONE",
  description: "On draws board cards one column height before you scroll to them, so cards no longer jump while you scroll a column. Off restores the old timing, where cards finished drawing only once they were on screen.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes when cards further down a column are drawn; the cards themselves look the same.",
  },
} as const satisfies FeatureFlagDefinition;
