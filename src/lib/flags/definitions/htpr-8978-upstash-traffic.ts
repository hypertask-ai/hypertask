import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8978_UPSTASH_TRAFFIC_FLAG = "htpr-8978-upstash-traffic";

export default {
  key: HTPR_8978_UPSTASH_TRAFFIC_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description:
    "Combines error-report rate counters into one command and checks hourly for projected Upstash traffic above 300,000 requests a day. Session revocation uses one MGET independently of this flag. Agent traffic removal remains separate work on this ticket.",
  releaseRisk: {
    risk: "none",
    reason: "No visible change. It only changes how many Upstash commands the same checks cost.",
  },
} as const satisfies FeatureFlagDefinition;
