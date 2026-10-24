import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7692_ALLOWANCE_DRIFT_CHECK_FLAG = "htpr-7692-allowance-drift-check";

export default {
  key: HTPR_7692_ALLOWANCE_DRIFT_CHECK_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description:
    "Observe platform-funded AI allowance counters and final refusals against Gateway reports. Off stops the checker and refusal recording; no allowance counters or admission rules are changed.",
  releaseRisk: {
    risk: "small",
    reason: "Observe-only infrastructure with bounded Redis evidence and alerts; never repairs counters or changes funded allowance decisions.",
  },
} as const satisfies FeatureFlagDefinition;
