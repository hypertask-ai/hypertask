import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6283_AGENT_CHAT_LIVE_SORT_FLAG = "htpr-6283-agent-chat-live-sort";

export default {
  key: HTPR_6283_AGENT_CHAT_LIVE_SORT_FLAG,
  kind: "feature",
  shippedOn: "2026-09-08",
  description:
    "Sorts the Agent Chat list by most recent chat message instead of a fixed order, and reorders live as messages arrive.",
  releaseRisk: {
    "risk": "small",
    "reason": "The existing Agent Chat roster reorders by the most recent message."
  },
} as const satisfies FeatureFlagDefinition;
