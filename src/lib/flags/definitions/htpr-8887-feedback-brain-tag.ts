import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8887_FEEDBACK_BRAIN_TAG_FLAG = "htpr-8887-feedback-brain-tag";

export default {
  key: HTPR_8887_FEEDBACK_BRAIN_TAG_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-07",
  description: "New tickets from the in-app feedback form get the brain-medium label as soon as they are created.",
  releaseRisk: {
    risk: "small",
    reason: "Adds one existing board label to new feedback tickets. Flag Off keeps today's user-feedback label only.",
  },
} as const satisfies FeatureFlagDefinition;
