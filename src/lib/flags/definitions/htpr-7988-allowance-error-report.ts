import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7988_ALLOWANCE_ERROR_REPORT_FLAG = "htpr-7988-allowance-error-report";

export default {
  key: HTPR_7988_ALLOWANCE_ERROR_REPORT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Expected daily and monthly AI allowance refusals no longer enter server error tracking or create crash tickets.",
  releaseRisk: {
    risk: "small",
    reason: "Only two exact expected refusal messages skip error reporting. AI limits, replies and real failure reporting stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
