import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9063_COMMENT_AUDIENCE_FLAG = "htpr-9063-comment-audience";

export default {
  key: HTPR_9063_COMMENT_AUDIENCE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-11",
  description: "An agent comment with no audience is refused and nothing is saved. Off still stores that note in the agent log.",
  releaseRisk: {
    risk: "small",
    reason: "Only an agent comment that names no audience is refused. A comment with question, qa or done, a human comment, and hypertask activity add stay as they are. Off keeps today's silent move into the agent log.",
  },
} as const satisfies FeatureFlagDefinition;
