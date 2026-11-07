import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8894_FEEDBACK_REPEAT_ACTIVITY_FLAG = "htpr-8894-feedback-repeat-activity";

export default {
  key: HTPR_8894_FEEDBACK_REPEAT_ACTIVITY_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-07",
  description: "A repeat report adds its activity to the existing feedback ticket, and a multiword command is stored as a slug.",
  related: ["htpr-8777-activity-board-number"],
  releaseRisk: {
    risk: "small",
    highRisk: "access",
    reason: "An agent who is not a board member can add a follow-up log on an ai-feedback ticket the caller can already read. Every other ticket still requires membership.",
  },
} as const satisfies FeatureFlagDefinition;
