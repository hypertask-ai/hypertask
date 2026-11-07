import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8084_CROSS_TEAM_AGENTS_FLAG = "htpr-8084-cross-team-agents";

export default {
  key: HTPR_8084_CROSS_TEAM_AGENTS_FLAG,
  shippedOn: "2026-10-27",
  description: "One owned agent joins boards across its owner's teams; cross-team conversations stay private to owner and agent.",
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  releaseRisk: {
    risk: "new",
    reason: "Extends explicit agent board grants across the owner's teams.",
    highRisk: "access",
  },
} as const satisfies FeatureFlagDefinition;
