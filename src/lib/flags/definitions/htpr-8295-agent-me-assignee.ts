import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8295_AGENT_ME_ASSIGNEE_FLAG = "htpr-8295-agent-me-assignee";

export default {
  key: HTPR_8295_AGENT_ME_ASSIGNEE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description: "An agent's ticket list filter assignee=me returns the tickets assigned to that agent, not the tickets assigned to its owner as a person. Off restores owner-based matching.",
  releaseRisk: {
    risk: "small",
    reason: "Narrows the agent's own list filter without changing assignments, board access or stored data.",
  },
} as const satisfies FeatureFlagDefinition;
