import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8171_HIDE_TAGS_FLAG = "htpr-8171-hide-tags";

export default {
  key: HTPR_8171_HIDE_TAGS_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-11",
  description:
    "A saved view can hide tickets that carry the tags you pick. The tags filter offers Hide, and AI chat can save that view when you ask for everything except those tags.",
  releaseRisk: {
    risk: "small",
    reason:
      "Adds one mode on the existing tags filter. With the switch off, a saved hide does not remove tickets, and Match ANY and Match ALL stay as they are.",
  },
} as const satisfies FeatureFlagDefinition;
