import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7728_COMMENT_SUMMARY_REFUSAL_FLAG = "htpr-7728-comment-summary-refusal";

export default {
  key: HTPR_7728_COMMENT_SUMMARY_REFUSAL_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-27",
  description: "Expected AI allowance refusals skip comment summaries without logging a server error. Real failures still log normally.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes logging for typed allowance refusals; funding limits, saved comments and successful summaries stay unchanged. Off restores logging.",
  },
} as const satisfies FeatureFlagDefinition;
