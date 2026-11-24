import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9361_BLOCKED_VIEW_DONE_FLAG = "htpr-9361-blocked-view-done";

export default {
  key: HTPR_9361_BLOCKED_VIEW_DONE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-22",
  description:
    "Blocked and Blocked by me leave out tickets in Done columns and show a one-line rule. Off counts finished tickets again and hides the line.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only the built-in Blocked and Blocked by me lists change. Saved views, blocker markers and permissions stay as they are. Off restores the previous count and hides the rule line.",
  },
} as const satisfies FeatureFlagDefinition;
