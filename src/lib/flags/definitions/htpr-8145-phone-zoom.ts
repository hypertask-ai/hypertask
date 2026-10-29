import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8145_PHONE_ZOOM_FLAG = "htpr-8145-phone-zoom";

export default {
  key: HTPR_8145_PHONE_ZOOM_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-29",
  description: "Allows phone pinch zoom while keeping text fields large enough to prevent focus zoom.",
  releaseRisk: {
    risk: "small",
    reason: "Phone viewport, text entry and swipe surfaces only; Off restores previous zoom settings.",
  },
} as const satisfies FeatureFlagDefinition;
