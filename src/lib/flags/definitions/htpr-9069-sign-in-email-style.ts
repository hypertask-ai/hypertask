import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9069_SIGN_IN_EMAIL_STYLE_FLAG = "htpr-9069-sign-in-email-style";

export default {
  key: HTPR_9069_SIGN_IN_EMAIL_STYLE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-17",
  description: "Sign-in emails use the shared Hypertask email layout: grey page, plain heading, one grey button, no emoji and a short Copy link instead of the raw long link.",
  releaseRisk: {
    risk: "small",
    reason: "Presentation only. The sign-in link and code are unchanged, and switching the flag Off restores the previous email.",
  },
} as const satisfies FeatureFlagDefinition;
