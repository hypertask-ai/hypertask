import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7146_AGENT_SCOPE_ENFORCE_FLAG = "htpr-7146-agent-scope-enforce";

export default {
  key: HTPR_7146_AGENT_SCOPE_ENFORCE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-20",
  defaultMode: "OFF",
  description: "An agent that already has boards can open only those boards. Off still lets an agent with no boards use its owner's boards. On requires an Accepted board for every agent.",
  releaseRisk: {
    risk: "small",
    highRisk: "access",
    reason: "Agents that already have boards lose every other board their owner can open. Off still leaves agents with no boards on owner access.",
    harmEvidence: {
      harm: "auth-bypass",
      scenario: "An agent login given only some boards could open every other board its owner can, including a private announcements board.",
    },
  },
} as const satisfies FeatureFlagDefinition;
