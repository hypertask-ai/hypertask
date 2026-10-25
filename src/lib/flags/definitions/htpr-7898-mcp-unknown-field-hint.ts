import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7898_MCP_UNKNOWN_FIELD_HINT_FLAG = "htpr-7898-mcp-unknown-field-hint";

export default {
  key: HTPR_7898_MCP_UNKNOWN_FIELD_HINT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "An MCP call with a mistyped field name now says which documented field the caller probably meant.",
  releaseRisk: {
    risk: "small",
    reason: "Only adds a suggestion to the existing unknown-field error; Off keeps today's message and no call changes behaviour.",
  },
} as const satisfies FeatureFlagDefinition;
