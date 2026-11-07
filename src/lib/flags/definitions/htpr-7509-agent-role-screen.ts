import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7509_AGENT_ROLE_SCREEN_FLAG = "htpr-7509-agent-role-screen";

export default {
  key: HTPR_7509_AGENT_ROLE_SCREEN_FLAG,
  kind: "feature",
  shippedOn: "2026-10-21",
  defaultMode: "EVERYONE",
  description: "Show agent roles in team settings and let the team owner change them using the command picker.",
  releaseRisk: {
    risk: "new",
    reason: "Lets team owners change external agents' read, write and admin access. Off refuses role changes.",
  },
} as const satisfies FeatureFlagDefinition;
