import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7480_COMMENT_SKILL_RUN_FLAG = "htpr-7480-comment-skill-run";

export default {
  key: HTPR_7480_COMMENT_SKILL_RUN_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-20",
  description: "Runs skills picked in comment editors in the existing inline AI writer for review before sending.",
  releaseRisk: {
    risk: "small",
    reason: "Changes only comment skill picks when inline comment AI is enabled; switching off restores text insertion.",
  },
} as const satisfies FeatureFlagDefinition;
