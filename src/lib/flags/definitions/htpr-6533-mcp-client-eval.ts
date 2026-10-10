import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6533_MCP_CLIENT_EVAL_FLAG = "htpr-6533-mcp-client-eval";

export default {
  key: HTPR_6533_MCP_CLIENT_EVAL_FLAG,
  kind: "feature",
  shippedOn: "2026-09-16",
  description:
    "Shows the MCP versus CLI eval table on the agents dashboard: success rate, tokens, wall time, and tool calls for Claude, Cursor, and Codex.",
  releaseRisk: {
    "risk": "new",
    "reason": "The agents dashboard adds a table comparing command-line and MCP client evaluations."
  },
} as const satisfies FeatureFlagDefinition;
