import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG = "htpr-6407-mobile-agent-chat-layout";

export default {
  key: HTPR_6407_MOBILE_AGENT_CHAT_LAYOUT_FLAG,
  kind: "improvement",
  shippedOn: "2026-09-11",
  description:
    "Pins the Agent Chat composer on mobile, keeps one message scroller, shows the agent name in the top bar, and makes mic dictation use the agent's board.",
  releaseRisk: {
    "risk": "small",
    "reason": "Mobile Agent Chat keeps the composer pinned and uses one message scroller."
  },
} as const satisfies FeatureFlagDefinition;
