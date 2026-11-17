import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9069_SIGN_IN_EMAIL_STYLE_FLAG = "htpr-9069-sign-in-email-style";

export default {
  key: HTPR_9069_SIGN_IN_EMAIL_STYLE_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-17",
  description: "Sign-in emails use the grey Hypertask layout: plain heading, one grey button, no emoji and a short Copy link instead of the raw long link. Other emails stay on the previous layout.",
  releaseRisk: {
    risk: "small",
    highRisk: "customer-email",
    reason: "Changes the sign-in email sent to customers. Off restores the previous sign-in email. Comment, digest and onboarding emails are unchanged.",
    harmEvidence: {
      harm: "customer-email",
      scenario: "A person who asks to sign in receives this email at their address, so a bad template reaches every sign-in request until the flag is switched Off.",
    },
  },
} as const satisfies FeatureFlagDefinition;
