import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7326_SLIM_MCP_INBOX_FLAG = "htpr-7326-slim-mcp-inbox";

export default {
  key: HTPR_7326_SLIM_MCP_INBOX_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-18",
  description:
    "Leaves full task descriptions out of the CLI and MCP inbox list so it downloads about a third less.",
  releaseRisk: {
    risk: "small",
    reason: "Only removes unused cached descriptions from CLI and MCP inbox responses.",
  },
} as const satisfies FeatureFlagDefinition;
