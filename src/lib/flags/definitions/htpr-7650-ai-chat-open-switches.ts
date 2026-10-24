import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG = "htpr-7650-ai-chat-open-switches";

export default {
  key: HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description: "Separate per-user AI chat auto-open switches for newly created tickets, opened tickets and boards, synced across browsers.",
  releaseRisk: {
    risk: "small",
    reason: "Optional chat presentation preferences; manual opening and legacy flag-off behavior remain available.",
  },
} as const satisfies FeatureFlagDefinition;
