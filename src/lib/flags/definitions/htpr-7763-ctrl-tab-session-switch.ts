import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7763_CTRL_TAB_SESSION_SWITCH_FLAG = "htpr-7763-ctrl-tab-session-switch";

export default {
  key: HTPR_7763_CTRL_TAB_SESSION_SWITCH_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Ctrl+Tab and Ctrl+Shift+Tab switch sessions in the visible desktop full-screen AI chat rail and focus the message box without wrapping.",
  releaseRisk: {
    risk: "small",
    reason: "Adds only desktop full-screen chat session shortcuts using the existing rail and selection path. Off restores the current keyboard behavior; docked chat is unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
