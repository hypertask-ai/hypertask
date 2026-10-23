import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7665_AGENT_READ_ROLE_GUARD_FLAG = "htpr-7665-agent-read-role-guard";

export default {
  key: HTPR_7665_AGENT_READ_ROLE_GUARD_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-23",
  defaultMode: "OWNER_AND_QA",
  description: "On stops agents with the read role from changing anything on boards, in the REST API and in the built-in AI chat. Off restores the old behavior where those changes went through.",
  releaseRisk: {
    risk: "small",
    highRisk: "access",
    reason: "Read agents lose write routes that were open to them; write and admin agents, agents with no stored role, and people are untouched. The flag follows the agent owner, so only Owner and QA agents are protected until Everyone.",
  },
} as const satisfies FeatureFlagDefinition;
