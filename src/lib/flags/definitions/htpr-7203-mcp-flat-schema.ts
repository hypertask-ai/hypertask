import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7203_MCP_FLAT_SCHEMA_FLAG = "htpr-7203-mcp-flat-schema";

export default {
  key: HTPR_7203_MCP_FLAT_SCHEMA_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-14",
  description: "Advertises Claude-compatible MCP tool schemas with action-specific variants nested inside input instead of top-level combinators.",
  releaseRisk: { risk: "small", reason: "Only advertised consolidated input schemas change; execution validation is unchanged and flag Off preserves the previous schemas." },
} as const satisfies FeatureFlagDefinition;
