import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7394_REMAINING_AI_SPEND_FLAG = "htpr-7394-remaining-ai-spend";

export default {
  key: HTPR_7394_REMAINING_AI_SPEND_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-08",
  description:
    "Holds batch spend until collection, charges each team for its search embeddings, turns native web search off on our keys, and keeps a long call's hold alive until the real cost settles.",
  releaseRisk: {
    risk: "new",
    highRisk: "money",
    reason:
      "Changes which AI calls are allowed to spend Hypertask money and how that spend is held against a team's monthly cap.",
    harmEvidence: {
      harm: "charge",
      scenario: "A capped team could be charged for a batch, an embedding, or a long call above the allowance that was held.",
    },
  },
} as const satisfies FeatureFlagDefinition;
