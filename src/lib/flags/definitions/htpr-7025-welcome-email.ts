import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7025_WELCOME_EMAIL_FLAG = "htpr-7025-welcome-email";

export default {
  key: HTPR_7025_WELCOME_EMAIL_FLAG,
  kind: "feature",
  shippedOn: "2026-10-09",
  description: "Sends new verified users a welcome email after sign-in with Claude Code connection instructions and their board link.",
} as const satisfies FeatureFlagDefinition;
