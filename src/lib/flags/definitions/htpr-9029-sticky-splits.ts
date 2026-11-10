import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9029_STICKY_SPLITS_FLAG = "htpr-9029-sticky-splits";

export default {
  key: HTPR_9029_STICKY_SPLITS_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description:
    "Inbox split tabs stay pinned at the top of the inbox list on desktop. Rows scroll under them, and a thin line shows under the tabs once the list is scrolled.",
  releaseRisk: {
    risk: "new",
    reason:
      "Visible UI change to the inbox split tabs under design review. Off keeps the tabs scrolling away with the list exactly as today.",
  },
} as const satisfies FeatureFlagDefinition;
