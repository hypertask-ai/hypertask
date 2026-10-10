import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7029_KEEP_DEMO_BOARD_ON_EMAIL_SIGNUP_FLAG = "htpr-7029-keep-demo-board-on-email-signup";

export default {
  key: HTPR_7029_KEEP_DEMO_BOARD_ON_EMAIL_SIGNUP_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-09",
  description: "Keeps demo work when signing up by email instead of creating an extra starter board and task.",
} as const satisfies FeatureFlagDefinition;
