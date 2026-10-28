import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8142_INBOX_KEYBOARD_FOCUS_FLAG = "htpr-8142-inbox-keyboard-focus";

export default {
  key: HTPR_8142_INBOX_KEYBOARD_FOCUS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-28",
  description: "Inbox J/K keep the selected row while scrolling beneath a stationary pointer, including blocked tickets.",
  releaseRisk: {
    risk: "small",
    reason: "Mouse movement still focuses rows. Off restores focus on mouse enter.",
  },
} as const satisfies FeatureFlagDefinition;
