import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7129_BOARD_CARD_FRESH_AFTER_ESCAPE_FLAG = "htpr-7129-board-card-fresh-after-escape";

export default {
  key: HTPR_7129_BOARD_CARD_FRESH_AFTER_ESCAPE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-11",
  description: "After editing priority, size or tags in a ticket and pressing Escape, the board card shows the new values right away instead of the old ones.",
  related: ["htpr-7003-board-back", "htpr-6752-instant-ticket-open"],
  releaseRisk: {
    "risk": "small",
    "reason": "Only how the board copy of a ticket is updated after an edit, and the board no longer loads twice when you come back from a ticket; nothing new on screen.",
  },
} as const satisfies FeatureFlagDefinition;
