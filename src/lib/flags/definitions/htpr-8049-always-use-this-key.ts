import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8049_ALWAYS_USE_THIS_KEY_FLAG = "htpr-8049-always-use-this-key";

export default {
  key: HTPR_8049_ALWAYS_USE_THIS_KEY_FLAG,
  kind: "feature",
  shippedOn: "2026-11-07",
  defaultMode: "OWNER_AND_QA",
  description:
    "Adds an Always use this key switch on each saved team key in Settings. On, AI requests use that key and skip the allowance, and the model picker lists only that key's models. Off keeps today's routing. Search and dictation stay on Hypertask keys.",
  releaseRisk: {
    risk: "new",
    highRisk: "money",
    reason: "A team admin can force every AI request onto one saved key and skip the included allowance, with no fallback if that key fails.",
  },
} as const satisfies FeatureFlagDefinition;
