import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6287_AGENT_CHAT_ROSTER_STATUS_FLAG = "htpr-6287-agent-chat-roster-status";

export default {
  key: HTPR_6287_AGENT_CHAT_ROSTER_STATUS_FLAG,
  kind: "feature",
  shippedOn: "2026-09-08",
  description: "Shows real per-agent status (active, idle, out of tokens, inactive) in the Agent Chat sidebar.",
  releaseRisk: {
    "risk": "small",
    "reason": "The existing Agent Chat roster shows each agent's actual activity and token status."
  },
} as const satisfies FeatureFlagDefinition;
