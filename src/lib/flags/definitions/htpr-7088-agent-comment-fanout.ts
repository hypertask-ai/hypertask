import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7088_AGENT_COMMENT_FANOUT_FLAG = "htpr-7088-agent-comment-fanout";

export default {
  key: HTPR_7088_AGENT_COMMENT_FANOUT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-10",
  description:
    "Agents following a ticket get its new comments in their inbox and webhook like assigned agents, and an agent no longer gets an inbox row or webhook for a comment it wrote itself.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only which agents receive a comment update changes; human notifications, owner rules and the comment payload stay the same."
  },
} as const satisfies FeatureFlagDefinition;
