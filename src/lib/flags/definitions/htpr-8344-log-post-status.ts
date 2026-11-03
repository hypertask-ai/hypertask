import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8344_LOG_POST_STATUS_FLAG = "htpr-8344-log-post-status";

export default {
  key: HTPR_8344_LOG_POST_STATUS_FLAG,
  kind: "bugfix",
  shippedOn: "2026-11-03",
  defaultMode: "EVERYONE",
  description: "An agent post saved to the hidden agent log answers 202 Accepted, not 201 Created, so a caller cannot mistake a log entry for a comment on the ticket.",
  releaseRisk: {
    risk: "small",
    reason: "Only the status code of a log-routed agent post changes; comment posts, routing and stored content stay as they are.",
  },
} as const satisfies FeatureFlagDefinition;
