import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8276_FEEDBACK_SLACK_LINE_FLAG = "htpr-8276-feedback-slack-line";

export default {
  key: HTPR_8276_FEEDBACK_SLACK_LINE_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description: "Posts one line to the team Slack channel for each new agent feedback ticket on board 15.",
  releaseRisk: {
    risk: "small",
    reason: "Only adds an outbound Slack line for internal feedback tickets; ticket creation, access rules and customer data are unchanged, and Flag Off stops the line.",
  },
} as const satisfies FeatureFlagDefinition;
