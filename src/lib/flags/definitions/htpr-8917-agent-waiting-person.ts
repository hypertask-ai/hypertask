import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8917_AGENT_WAITING_PERSON_FLAG = "htpr-8917-agent-waiting-person";

export default {
  key: HTPR_8917_AGENT_WAITING_PERSON_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-07",
  description: "A ticket can wait on an agent. The agent sees it in blockers and in Blocked by you.",
  releaseRisk: {
    risk: "small",
    reason: "Adds an agent id beside the waiting person. Turning it off refuses new agent writes and hides the agent in the waiting field.",
  },
} as const satisfies FeatureFlagDefinition;
