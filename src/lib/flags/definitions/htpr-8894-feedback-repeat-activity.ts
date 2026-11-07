import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8894_FEEDBACK_REPEAT_ACTIVITY_FLAG = "htpr-8894-feedback-repeat-activity";

export default {
  key: HTPR_8894_FEEDBACK_REPEAT_ACTIVITY_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-07",
  description: "A repeat report adds its activity to the existing feedback ticket, and a multiword command is stored as a slug.",
  related: ["htpr-8777-activity-board-number"],
  releaseRisk: {
    risk: "small",
    reason: "Only an ai-feedback ticket the caller can already read accepts a follow-up agent log when that agent is not a board member. Every other ticket still requires membership. A command that already fits is stored unchanged; a command with spaces is stored as a slug.",
  },
} as const satisfies FeatureFlagDefinition;
