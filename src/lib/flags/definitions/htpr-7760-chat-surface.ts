import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7760_CHAT_SURFACE_FLAG = "htpr-7760-chat-surface";

export default {
  key: HTPR_7760_CHAT_SURFACE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Tells AI chat which client the user is talking through, separately from the screen and ticket they are viewing.",
  releaseRisk: {
    risk: "small",
    reason: "Only adds chat identity and navigation honesty instructions. Off preserves the existing prompt; tools and permissions are unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
