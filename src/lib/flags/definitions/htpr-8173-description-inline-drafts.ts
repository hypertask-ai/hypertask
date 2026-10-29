import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8173_DESCRIPTION_INLINE_DRAFTS_FLAG = "htpr-8173-description-inline-drafts";

export default {
  key: HTPR_8173_DESCRIPTION_INLINE_DRAFTS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-29",
  description: "Restores inline AI draft review for task descriptions.",
  releaseRisk: {
    risk: "small",
    reason: "Restores the existing description writer; switching off preserves sidebar routing.",
  },
} as const satisfies FeatureFlagDefinition;
