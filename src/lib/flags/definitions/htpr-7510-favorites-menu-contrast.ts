import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7510_FAVORITES_MENU_CONTRAST_FLAG = "htpr-7510-favorites-menu-contrast";

export default {
  key: HTPR_7510_FAVORITES_MENU_CONTRAST_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-21",
  defaultMode: "EVERYONE",
  description: "Restores readable favorites menu text and borders and prevents centered scrolling when opening a board list.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes existing favorites menu theme tokens and scroll alignment; flag off preserves the current UI.",
  },
} as const satisfies FeatureFlagDefinition;
