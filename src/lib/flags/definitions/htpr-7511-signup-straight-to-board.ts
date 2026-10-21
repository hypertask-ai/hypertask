import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7511_SIGNUP_STRAIGHT_TO_BOARD_FLAG = "htpr-7511-signup-straight-to-board";

export default {
  key: HTPR_7511_SIGNUP_STRAIGHT_TO_BOARD_FLAG,
  kind: "feature",
  defaultMode: "OWNER_ONLY",
  shippedOn: "2026-10-21",
  releaseRisk: {
    risk: "new",
    highRisk: "access",
    reason: "Changes signup/session trust and customer email; also introduces a seven-day paid-plan trial entry point.",
  },
  description: "Updates the new board's AI starter instructions and points to the live first-task writer.",
} as const satisfies FeatureFlagDefinition;
