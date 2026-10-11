import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6978_SIZE_LABEL_CLICK_FLAG = "htpr-6978-size-label-click";

export default {
  key: HTPR_6978_SIZE_LABEL_CLICK_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-06",
  description: "Makes clicking size label words in the task size picker select that size without an error.",
} as const satisfies FeatureFlagDefinition;
