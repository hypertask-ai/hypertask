import type { FeatureFlagDefinition } from "../definitions"

export const HTPR_7195_AI_FEEDBACK_FLAG = "htpr-7195-ai-feedback"

export default {
  key: HTPR_7195_AI_FEEDBACK_FLAG,
  kind: "feature",
  shippedOn: "2026-10-13",
  description: "AI clients can report anonymous, deduplicated Hypertask failures to the product board without being asked.",
  releaseRisk: {
    risk: "new",
    reason: "Adds automatic ticket creation with server-side privacy scrubbing, account quotas and deduplication.",
  },
} as const satisfies FeatureFlagDefinition
