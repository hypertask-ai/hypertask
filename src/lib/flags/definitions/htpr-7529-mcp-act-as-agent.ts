import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7529_MCP_ACT_AS_AGENT_FLAG = "htpr-7529-mcp-act-as-agent";

export default {
  key: HTPR_7529_MCP_ACT_AS_AGENT_FLAG,
  kind: "feature",
  shippedOn: "2026-10-21",
  defaultMode: "OWNER_AND_QA",
  description: "On lets a person's MCP connection get or create a named agent and write comments, tickets, decisions and inbox actions as that agent with as_agent. Off rejects as_agent and agents ensure.",
  releaseRisk: {
    risk: "small",
    highRisk: "access",
    reason: "A signed-in person can attribute writes to an agent they own, only on boards that agent belongs to; agent and management-key connections cannot use it.",
  },
} as const satisfies FeatureFlagDefinition;
