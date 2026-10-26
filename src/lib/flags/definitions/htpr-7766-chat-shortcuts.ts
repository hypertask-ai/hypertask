import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7766_CHAT_SHORTCUTS_FLAG = "htpr-7766-chat-shortcuts";

export default {
  key: HTPR_7766_CHAT_SHORTCUTS_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-26",
  description: "One focused keyboard map for full-screen, sidebar and floating AI chat, with searchable help. Workspace shortcuts remain unchanged outside chat.",
  releaseRisk: {
    risk: "small",
    highRisk: "data-deletion",
    reason: "Desktop-only shortcuts include confirmed chat deletion through the existing action. Off restores the previous handlers and pickers without changing saved chats.",
  },
} as const satisfies FeatureFlagDefinition;
