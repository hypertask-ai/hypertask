import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8804_VISIBLE_LINKS_FIRST_FLAG = "htpr-8804-visible-links-first";

export default {
  key: HTPR_8804_VISIBLE_LINKS_FIRST_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-05",
  description: "Lists visible ticket links first in Ctrl+O.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes link ordering; Off preserves the previous order.",
  },
} as const satisfies FeatureFlagDefinition;
