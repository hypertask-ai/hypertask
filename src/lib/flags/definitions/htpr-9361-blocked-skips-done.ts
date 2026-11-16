import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9361_BLOCKED_SKIPS_DONE_FLAG =
  "htpr-9361-blocked-skips-done";

export default {
  key: HTPR_9361_BLOCKED_SKIPS_DONE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-15",
  description:
    "Blocked and Blocked by me leave out finished tickets and show one short line stating their rule, so the tab count matches the open work.",
  releaseRisk: {
    risk: "small",
    reason:
      "Display only: which existing cards the two built-in views list and count, plus one caption line. Saved views, blockers and permissions stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
