import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7032_FIRST_TIME_EMAIL_FLAG = "htpr-7032-first-time-email";

export default {
  key: HTPR_7032_FIRST_TIME_EMAIL_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-09",
  description: "Introduces the board in sign-in emails for new recipients. Recipients without an account are ineligible for Owner + QA; this variant stays off until the owner selects Everyone.",
} as const satisfies FeatureFlagDefinition;
