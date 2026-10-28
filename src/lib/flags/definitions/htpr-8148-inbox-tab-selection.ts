import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8148_INBOX_TAB_SELECTION_FLAG = "htpr-8148-inbox-tab-selection";

export default {
  key: HTPR_8148_INBOX_TAB_SELECTION_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-28",
  defaultMode: "EVERYONE",
  description: "Keeps the Inbox select-all checkbox inside the open tab, matching Ctrl+A. Explicit Ctrl+Shift+A still selects every tab.",
  releaseRisk: {
    risk: "small",
    reason: "Scopes the existing checkbox to the open tab. Archive, Undo, and explicit global selection keep their existing behavior.",
  },
} as const satisfies FeatureFlagDefinition;
