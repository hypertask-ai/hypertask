import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9016_COMMENT_COPY_LABELS_FLAG = "htpr-9016-comment-copy-labels";

export default {
  key: HTPR_9016_COMMENT_COPY_LABELS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-22",
  description:
    "Compare each ticket's search-index comment copies against the labels those copies actually mirror, not the ticket edit clock. Off keeps the old edit-clock comparison; the nightly drift pass still runs either way.",
  releaseRisk: {
    risk: "small",
    reason: "Read-only comparison inside the nightly index drift pass. It decides which comment copies to rewrite, never which tickets or comments exist.",
  },
} as const satisfies FeatureFlagDefinition;
