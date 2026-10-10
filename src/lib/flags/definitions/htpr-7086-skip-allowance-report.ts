import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7086_SKIP_ALLOWANCE_REPORT_FLAG = "htpr-7086-skip-allowance-report";

export default {
  key: HTPR_7086_SKIP_ALLOWANCE_REPORT_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-10",
  description:
    "The task writer no longer files an automatic error ticket when a team has used up its monthly AI allowance, which is a normal plan limit.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only server error reporting changes; what the user sees is the same."
  },
} as const satisfies FeatureFlagDefinition;
