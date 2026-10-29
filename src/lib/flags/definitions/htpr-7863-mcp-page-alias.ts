import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7863_MCP_PAGE_ALIAS_FLAG = "htpr-7863-mcp-page-alias";

export default {
  key: HTPR_7863_MCP_PAGE_ALIAS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "Lets MCP tool calls page results with a 1-based page number instead of failing on an unsupported field.",
  releaseRisk: { risk: "small", reason: "Input compatibility only; flag Off restores the previous refusal and every existing offset call is unchanged." },
} as const satisfies FeatureFlagDefinition;
