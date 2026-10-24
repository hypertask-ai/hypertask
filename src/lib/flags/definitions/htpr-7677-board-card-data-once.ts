import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7677_BOARD_CARD_DATA_ONCE_FLAG = "htpr-7677-board-card-data-once";

export default {
  key: HTPR_7677_BOARD_CARD_DATA_ONCE_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "A board reads your drafts and its running timers once for all its cards, instead of every card reading both lists itself, so the board draws sooner on a phone.",
  releaseRisk: {
    risk: "small",
    reason: "Cards show the same Draft mark and the same timer from the same data; only who reads it changes. The choice is made when the board opens, so a card never switches readers while open. Off restores one reader per card.",
  },
} as const satisfies FeatureFlagDefinition;
