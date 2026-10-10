import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6284_AGENT_MENTION_ROUTING_FLAG = "htpr-6284-agent-mention-routing";

export default {
  key: HTPR_6284_AGENT_MENTION_ROUTING_FLAG,
  kind: "feature",
  shippedOn: "2026-09-08",
  description:
    "When you @name an agent in the AI chat, your message goes to that agent and its reply appears in the chat under its name, instead of the AI assistant answering for it.",
  releaseRisk: {
    "risk": "small",
    "reason": "Mentioning an agent in the existing AI chat sends the message to that agent."
  },
} as const satisfies FeatureFlagDefinition;
