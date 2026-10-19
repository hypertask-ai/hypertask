import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7341_AGENT_CHATTER_TO_LOG_FLAG = "htpr-7341-agent-chatter-to-log";

export default {
  key: HTPR_7341_AGENT_CHATTER_TO_LOG_FLAG,
  kind: "feature",
  shippedOn: "2026-10-19",
  description: "Routes agent progress comments to the agent log while keeping questions, QA verdicts and closing summaries as comments.",
  releaseRisk: {
    risk: "new",
    reason: "Changes where untyped agent posts appear, with comment fallback when agent logs are unavailable.",
  },
} as const satisfies FeatureFlagDefinition;
