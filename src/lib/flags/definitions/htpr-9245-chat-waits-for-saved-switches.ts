import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9245_CHAT_WAITS_FOR_SAVED_SWITCHES_FLAG = "htpr-9245-chat-waits-for-saved-switches";

export default {
  key: HTPR_9245_CHAT_WAITS_FOR_SAVED_SWITCHES_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-22",
  description:
    "The AI chat waits for this account's saved auto-open switches before it opens by itself. A fresh browser, where every switch is off, no longer opens the chat once and then closes it.",
  related: ["htpr-7650-ai-chat-open-switches", "htpr-7530-keep-ai-chat-closed"],
  releaseRisk: {
    risk: "small",
    reason:
      "Only an automatic open waits for the switches this browser already holds or the account sends. Opening the chat by hand, a browser that already holds the switches, and the ticket and board switches themselves stay as they are. Off restores the immediate open.",
  },
} as const satisfies FeatureFlagDefinition;
