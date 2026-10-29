import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7804_BLOCKED_BY_ME_FLAG = "htpr-7804-blocked-by-me";

export default {
  key: HTPR_7804_BLOCKED_BY_ME_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Adds a built-in Blocked by me board view showing tickets waiting on the current viewer. Off hides the view and clears its selection.",
  releaseRisk: {
    risk: "new",
    reason: "Reuses board views and the existing blocker field; no saved data or permissions change.",
  },
} as const satisfies FeatureFlagDefinition;
