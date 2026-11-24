import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8978_AGENT_UPSTASH_SKIP_FLAG = "htpr-8978-agent-upstash-skip";

export default {
  key: HTPR_8978_AGENT_UPSTASH_SKIP_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-23",
  description: "Agent and command-line tool calls read feature flags from memory and count their own rate limit, so those calls do not use Upstash. Off sends them back to Upstash.",
  releaseRisk: {
    risk: "small",
    reason: "Agent and command-line calls stop reading Upstash for flags and rate limits. People still use Upstash. Off restores those Upstash reads. Tool calls keep working.",
  },
} as const satisfies FeatureFlagDefinition;
