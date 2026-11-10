import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9007_COLUMN_JK_SCROLL_FLAG = "htpr-9007-column-jk-scroll";

export default {
  key: HTPR_9007_COLUMN_JK_SCROLL_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description:
    "j and k inside a board column scroll the column that actually moves, so the focused card stays on screen.",
  releaseRisk: {
    risk: "small",
    reason:
      "Keyboard focus scrolls the column when the card list cannot move. Off restores the previous scroll target.",
  },
} as const satisfies FeatureFlagDefinition;
