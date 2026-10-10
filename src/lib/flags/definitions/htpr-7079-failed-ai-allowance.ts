import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7079_FAILED_AI_ALLOWANCE_FLAG = "htpr-7079-failed-ai-allowance";

export default {
  key: HTPR_7079_FAILED_AI_ALLOWANCE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-10",
  description:
    "An AI call that fails before it answers counts only its input against the plan's AI allowance instead of the full reserved amount.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only the allowance bookkeeping for failed AI calls changes; answered calls, real usage numbers and the 'unavailable' release keep working as before."
  },
} as const satisfies FeatureFlagDefinition;
