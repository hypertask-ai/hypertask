import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8861_AGENT_LOGIN_RECOVERY_FLAG = "htpr-8861-agent-login-recovery";

export default {
  key: HTPR_8861_AGENT_LOGIN_RECOVERY_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-07",
  description: "Owners can replace a revoked agent login from the existing access key panel without creating another identity.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses the owner-only token panel and preserves the agent identity and current team grant.",
    highRisk: "access",
  },
} as const satisfies FeatureFlagDefinition;
