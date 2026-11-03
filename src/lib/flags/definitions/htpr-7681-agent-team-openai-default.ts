import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7681_AGENT_TEAM_OPENAI_DEFAULT_FLAG = "htpr-7681-agent-team-openai-default";

export default {
  key: HTPR_7681_AGENT_TEAM_OPENAI_DEFAULT_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-03",
  description: "Uses the team's stored direct OpenAI key for default agent chat when the team has no Claude route.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes default agent-chat routing when the final credential is the team's stored direct OpenAI key. Off restores the previous routing.",
    highRisk: "money",
  },
} as const satisfies FeatureFlagDefinition;
