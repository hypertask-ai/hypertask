import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8812_CHAT_FIRST_MESSAGE_FLAG = "htpr-8812-chat-first-message";

export default {
  key: HTPR_8812_CHAT_FIRST_MESSAGE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-05",
  description: "Starts a conversation before sending the first message in an empty AI chat.",
  releaseRisk: { risk: "small", reason: "Reuses the existing conversation setup and session-isolated sender without changing chat layout, models, keys, or permissions." },
} as const satisfies FeatureFlagDefinition;
