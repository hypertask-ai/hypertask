import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8797_FEEDBACK_HOUSE_PARTS_FLAG = "htpr-8797-feedback-house-parts";

export default {
  key: HTPR_8797_FEEDBACK_HOUSE_PARTS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-06",
  description: "Feedback tickets use the house parts in plain words. Error codes and fingerprints stay in the agent log, and a repeat report still joins the same ticket.",
  releaseRisk: {
    risk: "small",
    reason: "Changes the words on new feedback tickets only. Flag Off keeps today's plain report, including the engineer lines in the description.",
  },
} as const satisfies FeatureFlagDefinition;
