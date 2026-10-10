import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6921_SLACK_MARKETPLACE_FLAG = "htpr-6921-slack-marketplace";

export default {
  key: HTPR_6921_SLACK_MARKETPLACE_FLAG,
  shippedOn: "2026-10-06",
  description:
    "Enables the public Slack support page and privacy, terms, and support links on Add to Slack. Anonymous visitors can access support only when set to Everyone.",
  kind: "improvement",
  releaseRisk: {
    "risk": "new",
    "reason": "Adds a public Slack support page and support links to the installation flow."
  },
} as const satisfies FeatureFlagDefinition;
