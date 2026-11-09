import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7983_FREE_MODE_SIGNUP_FLAG = "htpr-7983-free-mode-signup";

export default {
  key: HTPR_7983_FREE_MODE_SIGNUP_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-09",
  description: "Guest free board opens the AI chat on load and shows the Sign up button on phones.",
  releaseRisk: {
    risk: "small",
    reason: "Visible guest onboarding UI held at Owner + QA for independent design QA before Everyone, per HTPR-8712.",
  },
} as const satisfies FeatureFlagDefinition;
