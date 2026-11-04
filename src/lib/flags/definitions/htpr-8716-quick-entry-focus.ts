import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8716_QUICK_ENTRY_FOCUS_FLAG = "htpr-8716-quick-entry-focus";

export default {
  key: HTPR_8716_QUICK_ENTRY_FOCUS_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-04",
  description: "Opens N quick entry in the focused column before the hovered column.",
  releaseRisk: {
    risk: "small",
    reason: "Changes only column selection for quick entry; Off restores pointer precedence.",
  },
} as const satisfies FeatureFlagDefinition;
