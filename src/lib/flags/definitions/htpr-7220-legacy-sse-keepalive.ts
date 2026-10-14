import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7220_LEGACY_SSE_KEEPALIVE_FLAG = "htpr-7220-legacy-sse-keepalive";

export default {
  key: HTPR_7220_LEGACY_SSE_KEEPALIVE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-14",
  description: "Old-style AI tool connections (/sse) send a small keep-alive every minute, so a quiet connection is not cut off after about 5 minutes.",
  releaseRisk: {
    risk: "small",
    reason: "Only adds a Redis ping and an SSE comment line that clients ignore; tool calls are unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
