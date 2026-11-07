import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7552_AGENT_CODE_SIGNIN_FLAG = "htpr-7552-agent-code-signin";

export default {
  key: HTPR_7552_AGENT_CODE_SIGNIN_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-07",
  releaseRisk: {
    risk: "new",
    reason: "A person explicitly grants a new agent access to its own new Free board.",
    highRisk: "access",
    ownerRequest: {
      quote: "this one goes behind a feature flag that is only on for me at first pls. Don't release to everyone right away.",
      ticketUrl: "https://app.hypertask.ai/detail/project-15/7511",
    },
  },
  description: "Owner and QA agent sign-in with a five-minute code, explicit approval, and access to its new board only.",
} as const satisfies FeatureFlagDefinition;
