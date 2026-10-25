import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7841_INBOX_KEEPS_SCROLL_FLAG = "htpr-7841-inbox-keeps-scroll";

export default {
  key: HTPR_7841_INBOX_KEEPS_SCROLL_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "A live Inbox update no longer moves a list the reader has already scrolled.",
  releaseRisk: {
    risk: "small",
    reason: "Only scrolls when the focused Inbox row changes or would leave the viewport; Off keeps today's re-centring.",
  },
} as const satisfies FeatureFlagDefinition;
