import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7311_DECISION_COMMENT_LINK_FLAG = "htpr-7311-decision-comment-link";

export default {
  key: HTPR_7311_DECISION_COMMENT_LINK_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description: "Opening a ticket from the Inbox Decisions split jumps to and highlights the question waiting for your answer.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses existing comment-link scrolling and highlighting only for Decisions opens; off preserves existing Inbox navigation.",
  },
} as const satisfies FeatureFlagDefinition;
