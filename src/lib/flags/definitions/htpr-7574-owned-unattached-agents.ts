import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7574_OWNED_UNATTACHED_AGENTS_FLAG = "htpr-7574-owned-unattached-agents";

export default {
  key: HTPR_7574_OWNED_UNATTACHED_AGENTS_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-22",
  description: "Manage agents and the invite picker list the viewer's own agents that are not on any board yet, so the existing Not on any board group can show them.",
  releaseRisk: {
    risk: "small",
    highRisk: "access",
    reason: "Lists only active agents the viewer owns with no board; grant rules are unchanged, and other people's or other teams' agents stay hidden. Off restores the team-membership-only list.",
  },
} as const satisfies FeatureFlagDefinition;
