import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7756_CHAT_OPENS_TASK_FLAG = "htpr-7756-chat-opens-task";

export default {
  key: HTPR_7756_CHAT_OPENS_TASK_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "AI chat opens the requested task instead of only saying it opened it, and reports when navigation cannot be emitted or handled.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses authorized task lookup and the existing task navigator. Off disables opening tasks from chat.",
  },
} as const satisfies FeatureFlagDefinition;
