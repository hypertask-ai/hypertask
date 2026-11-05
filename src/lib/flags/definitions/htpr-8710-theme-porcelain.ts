import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8710_THEME_PORCELAIN_FLAG = "htpr-8710-theme-porcelain";

export default {
  key: HTPR_8710_THEME_PORCELAIN_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-04",
  description: "Controls the theme restoration rollout: theme-porcelain.",
  releaseRisk: { risk: "small", reason: "Controls an optional appearance choice." },
} as const satisfies FeatureFlagDefinition;
