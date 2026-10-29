import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8052_FULLSCREEN_CHAT_RETURN_FLAG = "htpr-8052-fullscreen-chat-return";

export default {
  key: HTPR_8052_FULLSCREEN_CHAT_RETURN_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-29",
  description: "Keeps chat open when leaving full screen.",
  releaseRisk: { risk: "small", reason: "Preserves the requested chat surface without changing saved automatic-opening choices." },
} as const satisfies FeatureFlagDefinition;
