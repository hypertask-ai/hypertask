import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7395_CACHED_STATIC_FIRST_FLAG = "htpr-7395-cached-static-first";

export default {
  key: HTPR_7395_CACHED_STATIC_FIRST_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "Cached tickets paint compatible descriptions before mounting the rich editor, including when its code is already warm.",
  related: ["htpr-7091-static-description-first", "htpr-7110-app-saved-static-description", "htpr-7116-ticket-stays-open", "htpr-7367-server-description-first"],
  releaseRisk: {
    risk: "small",
    reason: "Reuses the existing static description and rich editor with the same settled output; cached stable-layout, editing and unsupported rich content keep their current paths. Off restores immediate editor mounting.",
  },
} as const satisfies FeatureFlagDefinition;
