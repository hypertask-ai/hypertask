import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8978_UPSTASH_AUDIENCE_FLAG = "htpr-8978-upstash-audience";

export default {
  key: HTPR_8978_UPSTASH_AUDIENCE_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description: "Skips Upstash for agent flag reads and MCP rate limits, keeps human flag reads in a one-minute process cache, and records per-audience Upstash command metrics.",
  releaseRisk: {
    risk: "small",
    reason: "Changes how fast flag answers refresh for agents and cuts agent MCP rate-limit Redis use. Flag Off restores today's traffic.",
  },
} as const satisfies FeatureFlagDefinition;
