import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8261_CHAT_CLEANUP_FLAG = "htpr-8261-chat-cleanup";

export default {
  key: HTPR_8261_CHAT_CLEANUP_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description:
    "AI chat composer: microphone sits left of a word Send, dictation shows a Dictation pill, and no sparkle or purple is left in the floating and sidebar chat.",
  releaseRisk: {
    risk: "small",
    reason:
      "Reorders and restyles the existing chat controls only; dictation, sending and attachments keep their current behavior, and Off restores today's look.",
  },
} as const satisfies FeatureFlagDefinition;
