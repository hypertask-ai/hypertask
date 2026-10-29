import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7743_AI_USAGE_AUTH_FLAG = "htpr-7743-ai-usage-auth";

export default {
  key: HTPR_7743_AI_USAGE_AUTH_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description:
    "Show unavailable AI usage totals with a configuration warning when Gateway reporting rejects authorization. Off restores the legacy error response.",
  releaseRisk: {
    risk: "small",
    reason: "Read-only usage reporting; does not change credentials, authorization, billing, or allowance enforcement.",
  },
} as const satisfies FeatureFlagDefinition;
