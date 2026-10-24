import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7801_INBOX_VISIBLE_ORDER_FLAG = "htpr-7801-inbox-visible-order";

export default {
  key: HTPR_7801_INBOX_VISIBLE_ORDER_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "The next inbox ticket follows the visible list order, including blocked tickets.",
  releaseRisk: {
    risk: "small",
    reason: "Only orders the inbox navigation playlist using the existing list grouping. Off restores the raw notification order.",
  },
} as const satisfies FeatureFlagDefinition;
