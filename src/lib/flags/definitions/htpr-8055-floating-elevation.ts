import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8055_FLOATING_ELEVATION_FLAG = "htpr-8055-floating-elevation";

export default {
  key: HTPR_8055_FLOATING_ELEVATION_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description:
    "Floating AI chat and the Ctrl+J palette take one shared shadow from --shadow-floating instead of separate shadows.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only the shadow of two existing desktop panels changes; Off restores the chat's previous halo and the palette stays untouched.",
  },
} as const satisfies FeatureFlagDefinition;
