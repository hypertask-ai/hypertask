import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7553_EMAIL_STRAIGHT_BOARD_FLAG = "htpr-7553-email-straight-board";

export default {
  key: HTPR_7553_EMAIL_STRAIGHT_BOARD_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-08",
  releaseRisk: {
    risk: "new",
    reason: "New email can land on a board before inbox confirmation.",
    highRisk: "access",
    harmEvidence: { harm: "auth-bypass", scenario: "Unverified email could invite others before confirming the address." },
    ownerRequest: { quote: "only on for me at first", ticketUrl: "https://app.hypertask.ai/detail/project-15/7511" },
  },
  description: "New email lands on the board with a confirm banner; known emails keep the login code.",
} as const satisfies FeatureFlagDefinition;
