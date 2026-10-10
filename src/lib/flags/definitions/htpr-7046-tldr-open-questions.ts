import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7046_TLDR_OPEN_QUESTIONS_FLAG = "htpr-7046-tldr-open-questions";

export default {
  key: HTPR_7046_TLDR_OPEN_QUESTIONS_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-10",
  description: "Comment TL;DR summaries keep unanswered questions open and never add facts the comment did not state.",
  releaseRisk: {
    "risk": "small",
    "reason": "Two extra rules in the comment summary prompt; summaries stop answering questions the comment left open."
  },
} as const satisfies FeatureFlagDefinition;
