import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7047_SHARP_PLUS_SIGNS_FLAG = "htpr-7047-sharp-plus-signs";

export default {
  key: HTPR_7047_SHARP_PLUS_SIGNS_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-09",
  description: "Keeps the small and large add-task plus signs in board columns sharp at their existing sizes and positions.",
} as const satisfies FeatureFlagDefinition;
