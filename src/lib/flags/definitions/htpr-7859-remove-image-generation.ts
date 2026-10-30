import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7859_REMOVE_IMAGE_GENERATION_FLAG = "htpr-7859-remove-image-generation";

export default {
  key: HTPR_7859_REMOVE_IMAGE_GENERATION_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-29",
  description: "Remove AI image generation while retaining existing uploaded images.",
  releaseRisk: {
    risk: "small",
    reason: "Hides image generation controls and blocks new generation; Off restores the existing behavior.",
  },
} as const satisfies FeatureFlagDefinition;
