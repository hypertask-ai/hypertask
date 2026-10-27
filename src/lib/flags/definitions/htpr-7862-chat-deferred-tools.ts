import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7862_CHAT_DEFERRED_TOOLS_FLAG = "htpr-7862-chat-deferred-tools";

export default {
  key: HTPR_7862_CHAT_DEFERRED_TOOLS_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-27",
  description: "AI chat sends common tools first and discovers other tools when needed, without changing their permissions or execution.",
  releaseRisk: {
    risk: "small",
    reason: "Changes tool discovery only; existing tool schemas, authorization and confirmation remain unchanged. Switching off restores the complete catalog.",
  },
} as const satisfies FeatureFlagDefinition;
