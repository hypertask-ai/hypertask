import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7553_EMAIL_STRAIGHT_BOARD_FLAG = "htpr-7553-email-straight-board";

export default {
  key: HTPR_7553_EMAIL_STRAIGHT_BOARD_FLAG,
  kind: "feature",
  defaultMode: "OWNER_ONLY",
  shippedOn: "2026-11-08",
  releaseRisk: {
    risk: "new",
    reason: "A brand-new email can open a session and land on its board before the inbox confirms the address.",
    highRisk: "access",
    harmEvidence: {
      harm: "auth-bypass",
      scenario: "An unverified email could reach the board and invite others before confirming ownership of the address.",
    },
    ownerRequest: {
      quote:
        "this one goes behind a feature flag that is only on for me at first pls. Don't release to everyone right away.",
      ticketUrl: "https://app.hypertask.ai/detail/project-15/7511",
    },
  },
  description:
    "New email sign-up lands on the board at once with a confirm-email banner; known emails still use the login code.",
} as const satisfies FeatureFlagDefinition;
