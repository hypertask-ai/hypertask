import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7127_SLACK_SUMMARY_QUERY_FLAG = "htpr-7127-slack-summary-query";

export default {
  key: HTPR_7127_SLACK_SUMMARY_QUERY_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-11",
  releaseRisk: {
    "risk": "small",
    "reason": "The Slack summary job now picks only threads that still need a summary, so new threads are no longer hidden behind 50 finished ones; the comment text is unchanged.",
  },
  description: "New Slack threads linked to tickets get their summary comment even when 50 older threads are already summarized.",
} as const satisfies FeatureFlagDefinition;
