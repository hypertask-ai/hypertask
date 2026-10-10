import type { FeatureFlagDefinition } from "../definitions";

export const AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG = "htpr-6154-chat-stop-and-timeout";

export default {
  key: AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG,
  shippedOn: "2026-09-06",
  description:
    "Lets people stop stuck Agent Chat turns and ends unanswered turns after five minutes.",
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
} as const satisfies FeatureFlagDefinition;
