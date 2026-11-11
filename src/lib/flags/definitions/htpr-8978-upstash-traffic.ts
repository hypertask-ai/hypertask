import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8978_UPSTASH_TRAFFIC_FLAG = "htpr-8978-upstash-traffic";

export default {
  key: HTPR_8978_UPSTASH_TRAFFIC_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-11",
  description: "Counts agent tool requests in memory and files one urgent warning when daily Upstash requests exceed 300,000. Off restores shared agent counting and stops the warning job.",
  releaseRisk: {
    risk: "medium",
    reason: "Agent request limits become per server process. Authentication, human limits, spending controls and background locks stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
