import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG = "htpr-7530-keep-ai-chat-closed";

export default {
  key: HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "Adds a setting to keep AI chat closed until explicitly opened, overriding automatic opening on every page.",
  releaseRisk: {
    risk: "small",
    reason: "An optional browser preference prevents automatic chat opening; explicit opening and flag-off behavior stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
