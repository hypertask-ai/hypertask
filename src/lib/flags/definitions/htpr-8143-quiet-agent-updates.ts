import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8143_QUIET_AGENT_UPDATES_FLAG = "htpr-8143-quiet-agent-updates";

export default {
  key: HTPR_8143_QUIET_AGENT_UPDATES_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-28",
  description: "Agent moves and description edits stay in ticket history instead of creating inbox, push or email notifications. Human updates and agent questions, QA results and done comments stay unchanged.",
  releaseRisk: {
    risk: "small",
    highRisk: "customer-email",
    reason: "Suppresses automated move emails and pushes along with inbox rows, only for enabled recipients. Turning Off restores delivery; history and typed comment notifications stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
