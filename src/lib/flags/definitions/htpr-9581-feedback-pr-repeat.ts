import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9581_FEEDBACK_PR_REPEAT_FLAG = "htpr-9581-feedback-pr-repeat";

export default {
  key: HTPR_9581_FEEDBACK_PR_REPEAT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-22",
  description: "A repeat of the same feedback failure joins the open ticket when the note only changes the pull request number. The description still has no error code.",
  related: ["htpr-8797-feedback-house-parts", "htpr-8275-agent-feedback-note"],
  releaseRisk: {
    risk: "small",
    reason: "Only changes which open feedback ticket a repeat report joins. Flag Off keeps today's separate ticket when the note names a different pull request.",
  },
} as const satisfies FeatureFlagDefinition;
