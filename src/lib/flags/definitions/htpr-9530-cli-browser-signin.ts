import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9530_CLI_BROWSER_SIGNIN_FLAG = "htpr-9530-cli-browser-signin";

export default {
  key: HTPR_9530_CLI_BROWSER_SIGNIN_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-22",
  description: "The seeded onboarding task tells people to run hypertask login, which opens the browser. Off restores the token sentence.",
  releaseRisk: {
    risk: "small",
    reason: "Only the sign-in sentence on a new board's starter task changes. Settings, the install modal, and llms.txt already show this step. Off puts the token sentence back.",
  },
} as const satisfies FeatureFlagDefinition;
