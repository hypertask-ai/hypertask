import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8055_FLOATING_ELEVATION_FLAG = "htpr-8055-floating-elevation";

export default {
  key: HTPR_8055_FLOATING_ELEVATION_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-27",
  description: "Matches floating AI chat and Ctrl+J shadows and borders using shared theme tokens.",
  releaseRisk: {
    risk: "small",
    reason: "Only existing desktop panel shadows and borders change; Off restores their previous appearance.",
  },
} as const satisfies FeatureFlagDefinition;
