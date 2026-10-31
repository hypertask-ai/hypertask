import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8216_AGENT_TASK_SHARE_FLAG = "htpr-8216-agent-task-share";

export default {
  key: HTPR_8216_AGENT_TASK_SHARE_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-30",
  description:
    "Agents can make a ticket public and read back whether it is public, through MCP, instead of waiting for a person to copy the client link.",
  releaseRisk: {
    risk: "small",
    highRisk: "access",
    reason:
      "A ticket made public can be read by anyone holding the link, which is a public-access change. Off removes both doors and leaves the app Share modal unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
