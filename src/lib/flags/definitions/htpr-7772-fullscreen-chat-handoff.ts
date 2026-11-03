import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7772_FULLSCREEN_CHAT_HANDOFF_FLAG = "htpr-7772-fullscreen-chat-handoff";

export default {
  key: HTPR_7772_FULLSCREEN_CHAT_HANDOFF_FLAG,
  kind: "bugfix",
  shippedOn: "2026-11-03",
  defaultMode: "EVERYONE",
  description: "A ticket link in the full-screen chat opens the ticket with the same conversation in the side panel.",
  releaseRisk: { risk: "small", reason: "Opens the side panel the user already reached from the chat and keeps the conversation they were in; navigation targets and ticket access checks stay unchanged." },
} as const satisfies FeatureFlagDefinition;
