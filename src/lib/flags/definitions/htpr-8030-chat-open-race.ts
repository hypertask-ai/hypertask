import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8030_CHAT_OPEN_RACE_FLAG = "htpr-8030-chat-open-race";

export default {
  key: HTPR_8030_CHAT_OPEN_RACE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Keeps Open AI chat open during startup.",
  releaseRisk: { risk: "small", reason: "Only changes the existing Open button action." },
} as const satisfies FeatureFlagDefinition;
