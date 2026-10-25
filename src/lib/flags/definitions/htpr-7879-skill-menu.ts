import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7879_SKILL_MENU_FLAG = "htpr-7879-skill-menu";

export default {
  key: HTPR_7879_SKILL_MENU_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "Loads slash skills for the comment ticket or selected chat board instead of relying on the board-page state.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes skill-list project scoping; Off restores the previous board-page scope without hiding the menu.",
  },
} as const satisfies FeatureFlagDefinition;
