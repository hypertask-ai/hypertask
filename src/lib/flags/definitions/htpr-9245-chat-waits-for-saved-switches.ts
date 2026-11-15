import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9245_CHAT_WAITS_FOR_SAVED_SWITCHES_FLAG = "htpr-9245-chat-waits-for-saved-switches";

export default {
  key: HTPR_9245_CHAT_WAITS_FOR_SAVED_SWITCHES_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-15",
  description:
    "The AI chat waits for the account's saved auto-open switches before it opens by itself. A browser with no saved copy, where every switch is off, no longer opens the chat once and then closes it again.",
  related: ["htpr-7650-ai-chat-open-switches", "htpr-7530-keep-ai-chat-closed"],
  releaseRisk: {
    risk: "small",
    reason:
      "Only the automatic open waits for the answer this browser already has or the account sends. Manual opening, a browser that already holds the saved switches, and every ticket and board switch keep today's behaviour. Off restores the immediate open.",
  },
} as const satisfies FeatureFlagDefinition;
