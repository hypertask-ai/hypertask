import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7819_NOT_FOUND_NO_FEEDBACK_FLAG = "htpr-7819-not-found-no-feedback";

export default {
  key: HTPR_7819_NOT_FOUND_NO_FEEDBACK_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "A tool call that gets a 404 not found answer (wrong ticket number or no access) no longer files an automatic AI feedback ticket.",
  releaseRisk: {
    risk: "small",
    reason: "Only skips an automatic report for an expected not-found answer; the tool still returns the same error and 400 or 500 failures still file; Off keeps today's reports.",
  },
} as const satisfies FeatureFlagDefinition;
