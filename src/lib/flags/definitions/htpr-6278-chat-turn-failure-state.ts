import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6278_CHAT_TURN_FAILURE_FLAG = "htpr-6278-chat-turn-failure-state";

export default {
  key: HTPR_6278_CHAT_TURN_FAILURE_FLAG,
  shippedOn: "2026-09-08",
  description:
    "Ends AI Chat turns that run out of time with a clear, saved failure message instead of a silent disconnect, and shows the server's real refusal instead of 'Connection lost'.",
} as const satisfies FeatureFlagDefinition;
