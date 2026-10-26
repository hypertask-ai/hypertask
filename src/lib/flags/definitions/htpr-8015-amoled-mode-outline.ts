import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8015_AMOLED_MODE_OUTLINE_FLAG = "htpr-8015-amoled-mode-outline";

export default {
  key: HTPR_8015_AMOLED_MODE_OUTLINE_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Adds a matching hairline around the Search and New Task switch in the AMOLED theme.",
  releaseRisk: {
    risk: "small",
    reason: "Adds only a theme-scoped outline without changing the switch size or behavior; Off restores its previous appearance.",
  },
} as const satisfies FeatureFlagDefinition;
