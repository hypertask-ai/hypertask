import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7052_CHAT_NAMES_FLAG = "htpr-7052-chat-names";

export default {
  key: HTPR_7052_CHAT_NAMES_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-11",
  description: "Names a new AI chat after its ticket or board, then after its first message, instead of 'New AI Chat'.",
  releaseRisk: { risk: "small", reason: "Only the chat title text changes, and only for new chats; a manual rename is never overwritten." },
} as const satisfies FeatureFlagDefinition;
