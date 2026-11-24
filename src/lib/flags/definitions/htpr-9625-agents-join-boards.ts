import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9625_AGENTS_JOIN_BOARDS_FLAG = "htpr-9625-agents-join-boards";

export default {
  key: HTPR_9625_AGENTS_JOIN_BOARDS_FLAG,
  kind: "feature",
  shippedOn: "2026-11-23",
  defaultMode: "OWNER_AND_QA",
  description: "On lets an agent add itself to a board in its own team when its owner could invite it there. Off keeps that self-add refused.",
  releaseRisk: {
    risk: "new",
    highRisk: "access",
    reason: "An agent can grant itself membership on a board its owner could already invite it to.",
    harmEvidence: {
      harm: "auth-bypass",
      scenario: "An agent could add itself to a board in another team, or to a board its owner cannot open, and then read that board.",
    },
  },
} as const satisfies FeatureFlagDefinition;
