import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7133_MCP_RATELIMIT_FAST_FLAG = "htpr-7133-mcp-ratelimit-fast";

export default {
  key: HTPR_7133_MCP_RATELIMIT_FAST_FLAG,
  shippedOn: "2026-10-11",
  kind: "bugfix",
  description:
    "MCP calls far below the rate limit pre-pay 10 slots in Redis, then use reserved slots without waiting. No overshoot; unused slots may block up to 9 calls early per instance. Only Everyone enables this optimization; mode changes take up to 30 seconds.",
  releaseRisk: {
    risk: "small",
    reason: "Prepaid shared counts prevent overshoot; unused slots may block up to 9 calls early per instance, reserved only at or below half the anonymous limit.",
  },
} as const satisfies FeatureFlagDefinition;
