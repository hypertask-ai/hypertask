import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7764_CHAT_RUNNING_FLAG = "htpr-7764-chat-running";

export default {
  key: HTPR_7764_CHAT_RUNNING_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-27",
  description: "Shows a spinner in the AI chat header and conversation rows while each chat is replying.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses existing chat controls and per-session stream state. Off hides the indicators without changing replies or queues.",
  },
} as const satisfies FeatureFlagDefinition;
