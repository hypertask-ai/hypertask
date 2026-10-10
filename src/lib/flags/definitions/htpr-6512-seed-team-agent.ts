import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6512_SEED_TEAM_AGENT_FLAG = "htpr-6512-seed-team-agent";

export default {
  key: HTPR_6512_SEED_TEAM_AGENT_FLAG,
  shippedOn: "2026-09-16",
  description:
    "When Owner or QA opens Agent Chat or lists a team that has no live agent they can see, seed a Hyper AI agent on a board of that team so the roster is not empty.",
  releaseRisk: {
    "risk": "none",
    "reason": "Creates a default agent for teams that have none without adding an interface control."
  },
} as const satisfies FeatureFlagDefinition;
