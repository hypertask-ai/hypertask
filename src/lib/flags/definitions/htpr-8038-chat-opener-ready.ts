import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8038_CHAT_OPENER_READY_FLAG = "htpr-8038-chat-opener-ready";

export default {
  key: HTPR_8038_CHAT_OPENER_READY_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Makes chat openers available when their handlers attach.",
  releaseRisk: { risk: "small", reason: "Only guards existing chat buttons before hydration; layout and chat actions stay unchanged." },
} as const satisfies FeatureFlagDefinition;
