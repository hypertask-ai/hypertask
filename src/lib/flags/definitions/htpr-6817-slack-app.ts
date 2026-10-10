import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6817_SLACK_APP_FLAG = "htpr-6817-slack-app";

export default {
  key: HTPR_6817_SLACK_APP_FLAG,
  shippedOn: "2026-10-03",
  description:
    "Completes Slack app parity with conversational task creation, assistant thread context and persistent per-person account disconnection. Existing Slack behavior remains unchanged when off.",
  releaseRisk: {
    "risk": "new",
    "reason": "Adds conversational task creation and account connection flows to the official Slack app."
  },
} as const satisfies FeatureFlagDefinition;
