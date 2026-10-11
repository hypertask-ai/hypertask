import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7118_MCP_AGENT_CREATE_FLAG = "htpr-7118-mcp-agent-create";

export default {
  key: HTPR_7118_MCP_AGENT_CREATE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-11",
  description: "Lets a person create an agent through the MCP connector with their own sign-in, instead of failing with Authentication failed.",
  releaseRisk: {
    "risk": "small",
    "reason": "The create agent tool in the MCP connector now works for signed-in people, with the same board access check as the Add agent button."
  },
} as const satisfies FeatureFlagDefinition;
