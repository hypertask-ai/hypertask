import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8710_THEME_DIA_FLAG = "htpr-8710-theme-dia";

export default {
  key: HTPR_8710_THEME_DIA_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-04",
  description: "Controls the theme restoration rollout: theme-dia.",
  releaseRisk: { risk: "small", reason: "Controls an optional appearance choice." },
} as const satisfies FeatureFlagDefinition;
