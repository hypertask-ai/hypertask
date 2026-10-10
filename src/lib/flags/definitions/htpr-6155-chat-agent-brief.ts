import type { FeatureFlagDefinition } from "../definitions";

export const AGENT_CHAT_BRIEF_FLAG = "htpr-6155-chat-agent-brief";

export default {
  key: AGENT_CHAT_BRIEF_FLAG,
  shippedOn: "2026-09-05",
  description:
    "Gives Agent Chat a bounded snapshot of each agent's current and recent work.",
  releaseRisk: {
    "risk": "none",
    "reason": "Gives agents context about their current and recent work without adding interface controls."
  },
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
