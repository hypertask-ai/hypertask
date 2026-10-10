import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6926_MCP_ROUTE_WRAPPER_FLAG = "htpr-6926-mcp-route-wrapper";

export default {
  key: HTPR_6926_MCP_ROUTE_WRAPPER_FLAG,
  kind: "feature",
  shippedOn: "2026-10-06",
  description:
    "MCP API calls run through one shared route wrapper that checks the login once per call and keeps auth logs short. Switching takes up to 30 seconds to apply.",
  // Off until switched on: every agent token resolves to its human owner, so Owner + QA would
  // move all of Valentin's agents onto the new path at deploy (Infra Manager, 2026-10-06).
  defaultMode: "OFF",
} as const satisfies FeatureFlagDefinition;
