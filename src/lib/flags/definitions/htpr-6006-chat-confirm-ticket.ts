import type { FeatureFlagDefinition } from "../definitions";

export const AGENT_CHAT_TICKET_CONFIRM_FLAG = "htpr-6006-chat-confirm-ticket";

export default {
  key: AGENT_CHAT_TICKET_CONFIRM_FLAG,
  shippedOn: "2026-09-05",
  description: "Requires a confirmed board ticket before Agent Chat can start side-effecting work.",
  releaseRisk: {
    "risk": "none",
    "reason": "Adds stored ticket-confirmation safeguards for agent work without a new interface."
  },
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
