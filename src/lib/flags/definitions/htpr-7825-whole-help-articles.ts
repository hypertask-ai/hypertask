import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7825_WHOLE_HELP_ARTICLES_FLAG = "htpr-7825-whole-help-articles";

export default {
  key: HTPR_7825_WHOLE_HELP_ARTICLES_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Returns each help article in full from search. Off keeps the first 1500 characters.",
  releaseRisk: {
    risk: "new",
    reason: "Help search sends the rest of each article to the in-app AI. Off restores the 1500-character cap.",
  },
} as const satisfies FeatureFlagDefinition;
