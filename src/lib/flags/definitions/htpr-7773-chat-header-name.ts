import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7773_CHAT_HEADER_NAME_FLAG = "htpr-7773-chat-header-name";

export default {
  key: HTPR_7773_CHAT_HEADER_NAME_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "The AI chat header shows the open chat's name instead of the generic AI chat label.",
  releaseRisk: {
    risk: "small",
    reason: "Changes only the existing sidebar title on desktop and phone. Off restores the generic AI chat label.",
  },
} as const satisfies FeatureFlagDefinition;
