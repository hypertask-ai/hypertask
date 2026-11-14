import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9048_JEV_AUTO_MODEL_SHADOW_FLAG = "htpr-9048-jev-auto-model-shadow";

export default {
  key: HTPR_9048_JEV_AUTO_MODEL_SHADOW_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-11",
  description:
    "Every Auto chat turn also asks Jev which effort level fits the message and logs its guess next to the level Auto chose. Nothing the person sees changes and the chosen model stays Auto's.",
  releaseRisk: {
    risk: "small",
    reason:
      "The guess is written to a shadow log after Auto has already picked, adds no latency to the reply, and Off stops the extra call and the logging.",
  },
} as const satisfies FeatureFlagDefinition;
