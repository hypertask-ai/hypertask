import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7783_REMEMBER_CHAT_FLAG = "htpr-7783-remember-chat";

export default {
  key: HTPR_7783_REMEMBER_CHAT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Returning from Settings restores the selected AI chat, composer draft, scroll position and panel state for each user and board.",
  releaseRisk: {
    risk: "small",
    reason: "Remembers existing chat state in this browser without changing messages or permissions. Off keeps the existing navigation defaults.",
  },
} as const satisfies FeatureFlagDefinition;
