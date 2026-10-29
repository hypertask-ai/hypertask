import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8042_AMOLED_CHAT_BORDER_FLAG = "htpr-8042-amoled-chat-border";

export default {
  key: HTPR_8042_AMOLED_CHAT_BORDER_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Gives the floating AI chat an AMOLED outline matching the New Task box.",
  releaseRisk: {
    risk: "small",
    reason: "Only outlines the existing floating chat in AMOLED; Off restores its previous appearance.",
  },
} as const satisfies FeatureFlagDefinition;
