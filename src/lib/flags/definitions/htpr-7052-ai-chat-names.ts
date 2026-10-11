import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7052_AI_CHAT_NAMES_FLAG = "htpr-7052-ai-chat-names";

export default {
  key: HTPR_7052_AI_CHAT_NAMES_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-11",
  description: "Names a new AI chat from its first message, or from the ticket or board it was opened on, instead of 'New AI Chat'.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only the stored title of a brand-new chat changes; with the flag off every new chat keeps the old title and existing chats are never renamed."
  },
} as const satisfies FeatureFlagDefinition;
