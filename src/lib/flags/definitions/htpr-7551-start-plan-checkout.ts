import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7551_START_PLAN_CHECKOUT_FLAG = "htpr-7551-start-plan-checkout";

export default {
  key: HTPR_7551_START_PLAN_CHECKOUT_FLAG,
  kind: "feature",
  defaultMode: "OWNER_ONLY",
  shippedOn: "2026-10-21",
  releaseRisk: {
    risk: "new",
    reason: "Adds server-selected paid plan checkout and changes eligible trials to seven days.",
    highRisk: "money",
    ownerRequest: {
      quote: "this one goes behind a feature flag that is only on for me at first pls. Don't release to everyone right away.",
      ticketUrl: "https://app.hypertask.ai/detail/project-15/7511",
    },
  },
  description: "Owner-only preview of Start-plan checkout with server-selected monthly Pro pricing and seven-day trials.",
} as const satisfies FeatureFlagDefinition;
