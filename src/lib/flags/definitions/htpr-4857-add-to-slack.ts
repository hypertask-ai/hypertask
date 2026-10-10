import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_4857_ADD_TO_SLACK_FLAG = "htpr-4857-add-to-slack";

export default {
  key: HTPR_4857_ADD_TO_SLACK_FLAG,
  shippedOn: "2026-09-09",
  description:
    "Enables the public /add-to-slack page and the Slack Marketplace install resume path (callback without signed state sends visitors to login, then Settings completes the link). Flip to Everyone before the Slack Marketplace submission.",
  releaseRisk: {
    "risk": "new",
    "reason": "Adds a public Add to Slack page and resumes installation after sign-in."
  },
} as const satisfies FeatureFlagDefinition;
