import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8093_AGENT_CHAT_KEYS_FLAG = "htpr-8093-agent-chat-keys";

export default {
  key: HTPR_8093_AGENT_CHAT_KEYS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description:
    "A key typed in a chat box in the AI sidebar stays in the box. Agent chats now use the same focus check as the regular AI chat, so page shortcuts no longer fire while you type in them.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only pages that run their own keyboard map change, and only while a chat box in the AI sidebar, the floating chat window or the full-screen chat has focus. Off keeps today's shortcuts firing inside an agent chat.",
  },
} as const satisfies FeatureFlagDefinition;
