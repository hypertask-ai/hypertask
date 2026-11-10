import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9021_NO_EMPTY_CHATS_FLAG = "htpr-9021-no-empty-chats";

export default {
  key: HTPR_9021_NO_EMPTY_CHATS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description: "Creates an AI chat only when a person sends a message or asks for a new chat, and hides chats with no messages from history.",
  releaseRisk: { risk: "small", reason: "Stops background creation of empty chat rows and hides them from the history list. Saved messages, models, keys and permissions are unchanged." },
} as const satisfies FeatureFlagDefinition;
