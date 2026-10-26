import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7734_AGENT_CHAT_CONTEXT_FLAG = "htpr-7734-agent-chat-context";

export default {
  key: HTPR_7734_AGENT_CHAT_CONTEXT_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-24",
  description: "Reuse the AI chat scope picker in docked agent chats and send the selected ticket or board context with each message.",
  releaseRisk: {
    risk: "small",
    highRisk: "access",
    reason: "Discloses selected board and ticket titles to external agents and adds sender and recipient authorization checks. Switching Off restores the previous chat behavior and removes these context-specific checks; it cannot retract titles already delivered.",
  },
} as const satisfies FeatureFlagDefinition;
