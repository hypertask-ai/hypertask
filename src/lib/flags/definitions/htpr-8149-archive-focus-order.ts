import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8149_ARCHIVE_FOCUS_ORDER_FLAG = "htpr-8149-archive-focus-order";

export default {
  key: HTPR_8149_ARCHIVE_FOCUS_ORDER_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-29",
  description: "Keeps keyboard archive focus in visible card order and on the column when it empties.",
  releaseRisk: {
    risk: "small",
    reason: "Uses the rendered cards for focus only; archive requests, Undo and manual navigation remain unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
