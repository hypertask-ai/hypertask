import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7289_RESUME_SIGNUP_PROVISIONING_FLAG = "htpr-7289-resume-signup-provisioning";

export default {
  key: HTPR_7289_RESUME_SIGNUP_PROVISIONING_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-17",
  description: "A sign-in by an account whose first setup failed in the last seven days finishes that setup and records its one signup event.",
  releaseRisk: { risk: "small", highRisk: "access", reason: "Runs only for accounts with no saved Stripe customer that joined in the last seven days; flag Off restores today's sign-in with no recovery." },
} as const satisfies FeatureFlagDefinition;
