import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9076_NARROW_INBOX_LAYOUT_FLAG = "htpr-9076-narrow-inbox-layout";

export default {
  key: HTPR_9076_NARROW_INBOX_LAYOUT_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-11",
  description:
    "Inbox split tabs stay at the top when the inbox is narrow, such as beside the AI chat. Narrow rows drop their tags to keep the title readable.",
  releaseRisk: {
    risk: "small",
    reason:
      "Visible inbox layout change under design review. Off keeps today's behaviour, where narrow inboxes move the tabs to the bottom and squeeze the tags.",
  },
} as const satisfies FeatureFlagDefinition;
