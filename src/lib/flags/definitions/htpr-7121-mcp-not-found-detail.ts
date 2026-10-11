import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7121_MCP_NOT_FOUND_DETAIL_FLAG = "htpr-7121-mcp-not-found-detail";

export default {
  key: HTPR_7121_MCP_NOT_FOUND_DETAIL_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-11",
  description: "Creating a ticket through MCP with a label that is not on the board now says which label was not found, instead of a vague server error.",
  releaseRisk: { risk: "small", reason: "Only changes an error response from a 500 to a 404 naming the unknown label ids; successful creates are untouched." },
} as const satisfies FeatureFlagDefinition;
