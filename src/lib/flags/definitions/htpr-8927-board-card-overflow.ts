import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8927_BOARD_CARD_OVERFLOW_FLAG = "htpr-8927-board-card-overflow";

export default {
  key: HTPR_8927_BOARD_CARD_OVERFLOW_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description:
    "Kanban cards clip long blocker lines and tag names inside the card so board columns never scroll sideways.",
  releaseRisk: {
    risk: "small",
    reason:
      "Long blocker chips, tags and other card rows truncate at the card edge and columns hide horizontal overflow. Off restores the previous layout where wide card content could widen a column.",
  },
} as const satisfies FeatureFlagDefinition;
