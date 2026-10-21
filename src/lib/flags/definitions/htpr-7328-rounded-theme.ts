import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7328_ROUNDED_THEME_FLAG = "htpr-7328-rounded-theme";

export default {
  key: HTPR_7328_ROUNDED_THEME_FLAG,
  kind: "feature",
  shippedOn: "2026-10-19",
  description: "Adds the Material theme (Material 3 shapes, Gemini colours), following the device light or dark setting.",
  releaseRisk: {
    risk: "small",
    reason: "Adds one theme choice; other themes unchanged",
  },
} as const satisfies FeatureFlagDefinition;
