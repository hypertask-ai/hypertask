import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9530_ONBOARDING_CLI_BROWSER_LOGIN_FLAG = "htpr-9530-onboarding-cli-browser-login";

export default {
  key: HTPR_9530_ONBOARDING_CLI_BROWSER_LOGIN_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-25",
  description:
    "Onboarding's connect-your-AI starter task gives the same CLI sign-in step as Settings and llms.txt: hypertask login opens the browser.",
  releaseRisk: {
    risk: "small",
    reason:
      "Rewrites one onboarding starter-task sentence to the browser sign-in step. Off restores the previous token sentence, which is the only thing the task's copy changes.",
  },
} as const satisfies FeatureFlagDefinition;
