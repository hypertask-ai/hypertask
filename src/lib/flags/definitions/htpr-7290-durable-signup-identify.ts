import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7290_DURABLE_SIGNUP_IDENTIFY_FLAG = "htpr-7290-durable-signup-identify";

export default {
  key: HTPR_7290_DURABLE_SIGNUP_IDENTIFY_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-17",
  defaultMode: "EVERYONE",
  description: "Saves signup identity links before sending them so failed analytics requests can retry.",
  releaseRisk: {
    risk: "small",
    reason: "Uses the existing delivery queue and keeps consent checks while preventing links across accounts.",
  },
} as const satisfies FeatureFlagDefinition;
