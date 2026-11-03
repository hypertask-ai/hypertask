import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8241_PAGES_INTENT_HOLD_FLAG = "htpr-8241-pages-intent-hold";

export default {
  key: HTPR_8241_PAGES_INTENT_HOLD_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description: "Ctrl+K Link page and New page wait for the ticket pages panel instead of firing a lost one-time event.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses the existing page chooser and page creation. Off restores the old one-shot command behaviour.",
  },
} as const satisfies FeatureFlagDefinition;
