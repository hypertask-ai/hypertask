import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7734_AGENT_CHAT_CONTEXT_FLAG = "htpr-7734-agent-chat-context";

export default {
  key: HTPR_7734_AGENT_CHAT_CONTEXT_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Reuse the AI chat scope picker in docked agent chats and send the selected ticket or board context with each message.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses the existing scope picker and message delivery paths; selected context is checked against the sender's access and flag-off behavior is unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
