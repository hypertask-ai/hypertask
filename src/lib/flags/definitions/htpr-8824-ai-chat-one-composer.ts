import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8824_AI_CHAT_ONE_COMPOSER_FLAG = "htpr-8824-ai-chat-one-composer";

export default {
  key: HTPR_8824_AI_CHAT_ONE_COMPOSER_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-09",
  description:
    "The full-screen, sidebar and floating AI chat share one text box. The plus menu and the Ctrl+J microphone sit inside it with Send, and the board picker and model picker sit below it.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only moves the existing controls on desktop. Sending, dictation, attachments, context and the pickers behave the same, and Off restores the previous layout.",
  },
} as const satisfies FeatureFlagDefinition;
