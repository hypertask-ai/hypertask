import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7644_BOARD_CARDS_FIRST_DRAW_FLAG = "htpr-7644-board-cards-first-draw";

export default {
  key: HTPR_7644_BOARD_CARDS_FIRST_DRAW_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description: "A board column whose card code is already loaded draws its real cards in its first draw, instead of grey placeholder cards that swap to real cards about 0.27 s later.",
  releaseRisk: {
    risk: "small",
    reason: "The same card component renders the same cards; only the placeholder frames before them are skipped when the card code is already loaded. While flags are still loading on a first visit the column follows this default (Everyone); once Off arrives, mounted columns switch back to the lazy card with placeholders and new columns start there.",
  },
} as const satisfies FeatureFlagDefinition;
