import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7035_DEMO_LOGIN_OWN_BOARD_FLAG = "htpr-7035-demo-login-own-board";

export default {
  key: HTPR_7035_DEMO_LOGIN_OWN_BOARD_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-09",
  description: "Returns demo visitors logging into an existing account to an accessible board, while keeping adopted demo boards for new accounts.",
} as const satisfies FeatureFlagDefinition;
