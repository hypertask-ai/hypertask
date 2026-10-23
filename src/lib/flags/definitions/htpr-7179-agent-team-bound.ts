import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7179_AGENT_TEAM_BOUND_FLAG = "htpr-7179-agent-team-bound";

export default {
  key: HTPR_7179_AGENT_TEAM_BOUND_FLAG,
  kind: "improvement",
  shippedOn: "2026-10-23",
  defaultMode: "EVERYONE",
  description: "The owner's agent list says whether each agent's sign-in is limited to one team (yes or no only).",
  releaseRisk: {
    risk: "small",
    reason: "Adds one owner-only yes/no field to the agent list; no team id, binding or token material. Off removes the field.",
  },
} as const satisfies FeatureFlagDefinition;
