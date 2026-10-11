import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7133_MCP_RATELIMIT_FAST_FLAG = "htpr-7133-mcp-ratelimit-fast";

export default {
  key: HTPR_7133_MCP_RATELIMIT_FAST_FLAG,
  shippedOn: "2026-10-11",
  kind: "bugfix",
  description:
    "MCP calls far below the rate limit count in Redis without waiting for its reply. Only Everyone enables this optimization; mode changes take up to 30 seconds.",
  releaseRisk: {
    risk: "small",
    reason: "Other instances can temporarily exceed the limit before background counts confirm; higher counts return to synchronous enforcement.",
  },
} as const satisfies FeatureFlagDefinition;
