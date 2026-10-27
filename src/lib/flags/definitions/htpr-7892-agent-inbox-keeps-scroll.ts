import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7892_AGENT_INBOX_KEEPS_SCROLL_FLAG = "htpr-7892-agent-inbox-keeps-scroll";

export default {
  key: HTPR_7892_AGENT_INBOX_KEEPS_SCROLL_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "A live Agent Inbox update no longer re-centres a list the reader has already scrolled.",
  releaseRisk: {
    risk: "small",
    reason: "Only scrolls when the focused Agent Inbox row changes or would leave the viewport; Off keeps today's re-centring.",
  },
} as const satisfies FeatureFlagDefinition;
