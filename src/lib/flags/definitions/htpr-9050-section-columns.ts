import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9050_SECTION_COLUMNS_FLAG = "htpr-9050-section-columns";

export default {
  key: HTPR_9050_SECTION_COLUMNS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description:
    "A refusal for a column that is not on the board names the board's own columns with their ids, so an agent moving a ticket into a review lane no longer has to infer it.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only the text of an existing 400/404 refusal changes, on the error path, and only for boards whose columns the caller can already list. Off restores the bare refusal.",
  },
} as const satisfies FeatureFlagDefinition;
