import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8031_AUTO_TITLE_FLAG = "htpr-8031-auto-title";

export default {
  key: HTPR_8031_AUTO_TITLE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Accepts title-only generation for new tasks and saves a description-based fallback when title generation fails.",
  releaseRisk: {
    risk: "small",
    reason: "Restores automatic titles without changing writer prompts, models or the full-task draft requirement.",
  },
} as const satisfies FeatureFlagDefinition;
