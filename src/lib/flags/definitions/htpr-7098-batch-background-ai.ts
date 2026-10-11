import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7098_BATCH_BACKGROUND_AI_FLAG = "htpr-7098-batch-background-ai";

// HTPR-7098 (https://app.hypertask.ai/detail/project-15/7098): half-price background AI.
export default {
  key: HTPR_7098_BATCH_BACKGROUND_AI_FLAG,
  kind: "feature",
  shippedOn: "2026-10-11",
  description:
    "Sends Slack thread summaries and smart label backfills to the Anthropic Batch API at half price. Results arrive within minutes to hours instead of seconds. Off runs them right away as before.",
  releaseRisk: {
    "risk": "small",
    "reason": "Same prompts and same answers at half the price; summaries and label backfills just arrive later, and teams with their own AI key keep the instant path."
  },
} as const satisfies FeatureFlagDefinition;
