import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9070_CALM_FOCUS_BAR_FLAG = "htpr-9070-calm-focus-bar";

export default {
  key: HTPR_9070_CALM_FOCUS_BAR_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-17",
  description: "Keyboard focus draws a thin bar inside the kanban card edge without changing the card border or padding, so moving focus with J and K never shifts card content. Off restores the previous left border bar.",
  releaseRisk: {
    risk: "small",
    reason: "Only the focused card's left bar changes: it is painted inside the card instead of taking four pixels of border. Card size, content position and every other state stay as they are.",
  },
} as const satisfies FeatureFlagDefinition;
