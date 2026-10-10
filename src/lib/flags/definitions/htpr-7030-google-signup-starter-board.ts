import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7030_GOOGLE_SIGNUP_STARTER_BOARD_FLAG = "htpr-7030-google-signup-starter-board";

export default {
  key: HTPR_7030_GOOGLE_SIGNUP_STARTER_BOARD_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-09",
  description: "Gives new Google signups a starter board and agent connection task when they have no demo workspace to keep.",
} as const satisfies FeatureFlagDefinition;
