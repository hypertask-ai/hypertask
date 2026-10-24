import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7770_AI_CHAT_DRAFTS_FLAG = "htpr-7770-ai-chat-drafts";

export default {
  key: HTPR_7770_AI_CHAT_DRAFTS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Keeps unsent AI chat drafts per session through replies, chat switches and reloads.",
  releaseRisk: {
    risk: "small",
    reason: "Client-only composer persistence and background-send isolation shared by docked and full-screen chat. Off restores existing draft handling.",
  },
} as const satisfies FeatureFlagDefinition;
