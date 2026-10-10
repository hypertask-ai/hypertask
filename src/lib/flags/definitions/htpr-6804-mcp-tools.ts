import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6804_MCP_TOOLS_FLAG = "htpr-6804-mcp-tools";

export default {
  key: HTPR_6804_MCP_TOOLS_FLAG,
  shippedOn: "2026-10-03",
  description:
    "Advertises consolidated MCP tools with action parameters, concise structured responses and actionable errors while retaining callable legacy names.",
  kind: "improvement",
} as const satisfies FeatureFlagDefinition;
