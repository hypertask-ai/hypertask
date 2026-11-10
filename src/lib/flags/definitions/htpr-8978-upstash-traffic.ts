import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8978_UPSTASH_TRAFFIC_FLAG = "htpr-8978-upstash-traffic";

export default {
  key: HTPR_8978_UPSTASH_TRAFFIC_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description:
    "Keeps per-request Upstash traffic down: one MGET for session revocation, one command per error report, process-memory limits on the CLI and MCP token endpoints, and an hourly alarm above 300,000 requests a day. Flag Off restores one Redis command per check.",
  releaseRisk: {
    risk: "none",
    reason: "No visible change. It only changes how many Upstash commands the same checks cost.",
  },
} as const satisfies FeatureFlagDefinition;
