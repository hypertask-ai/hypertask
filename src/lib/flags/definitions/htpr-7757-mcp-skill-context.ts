import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7757_MCP_SKILL_CONTEXT_FLAG = "htpr-7757-mcp-skill-context";

export default {
  key: HTPR_7757_MCP_SKILL_CONTEXT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Includes matched skill templates and active-skill summaries in MCP task and comment responses.",
  releaseRisk: {
    risk: "small",
    reason: "Adds request-local context to existing authorized responses; switching off skips skill matching and template delivery without changing stored content or permissions.",
  },
} as const satisfies FeatureFlagDefinition;
