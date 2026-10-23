import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7462_MCP_RATELIMIT_EXACT_COUNT_FLAG = "htpr-7462-mcp-ratelimit-exact-count";

export default {
  key: HTPR_7462_MCP_RATELIMIT_EXACT_COUNT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description: "Every MCP call counts once against the per-minute limit, so slots pre-paid by idle server instances no longer refuse light reads early.",
  releaseRisk: {
    risk: "small",
    reason: "Restores the existing per-call Redis count without changing limits or responses; flag Off preserves prepaid slots.",
  },
} as const satisfies FeatureFlagDefinition;
