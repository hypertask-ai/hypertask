import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6516_AGENT_ATTRIBUTION_FLAG = "htpr-6516-agent-attribution";

export default {
  key: HTPR_6516_AGENT_ATTRIBUTION_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-09-16",
  description:
    "Shows the agent that made a comment, move, assignment or label change by the name it acted under, including after that agent is deleted. Without it a retired agent reads as Private agent.",
  releaseRisk: {
    "risk": "small",
    "reason": "Comments and task history show the acting agent name instead of Private agent."
  },
} as const satisfies FeatureFlagDefinition;
