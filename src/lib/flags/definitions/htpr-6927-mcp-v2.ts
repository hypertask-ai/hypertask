import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6927_MCP_V2_FLAG = "htpr-6927-mcp-v2";

export default {
  key: HTPR_6927_MCP_V2_FLAG,
  shippedOn: "2026-10-06",
  description: "Adds MCP tool safety hints, scope-aware legacy catalogs and a staged task update pipeline.",
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
