import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7868_EMPTY_FIELD_LABELS_FLAG = "htpr-7868-empty-field-labels";

export default {
  key: HTPR_7868_EMPTY_FIELD_LABELS_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-09",
  description:
    "An empty Due date shows No due date and an empty Task size shows No size in the ticket side panel and the new task window, instead of a bare dash.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only changes the text shown for an empty Due date and an empty Task size. Nothing else on the row moves, and Off restores the dash.",
  },
} as const satisfies FeatureFlagDefinition;
