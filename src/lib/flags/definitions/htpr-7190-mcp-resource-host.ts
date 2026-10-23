import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7190_MCP_RESOURCE_HOST_FLAG = "htpr-7190-mcp-resource-host";

export default {
  key: HTPR_7190_MCP_RESOURCE_HOST_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-13",
  description: "Keeps MCP OAuth discovery on the supported host the client connected to so sign-in can discover tools.",
  releaseRisk: { risk: "small", reason: "Only unauthenticated discovery metadata and challenges change; trusted hosts are allowlisted and flag Off preserves the previous resource URLs." },
} as const satisfies FeatureFlagDefinition;
