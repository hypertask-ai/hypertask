import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7688_PAST_CHATS_FIRST_FLAG = "htpr-7688-past-chats-first";

export default {
  key: HTPR_7688_PAST_CHATS_FIRST_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description: "Lists personal AI chat history before agents and matches working status to fresh active runs.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses existing conversation rows and session selection. Off restores the agent-only menu and runtime status text.",
  },
} as const satisfies FeatureFlagDefinition;
