import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7394_REMAINING_AI_SPEND_FLAG = "htpr-7394-remaining-ai-spend";

export default {
  key: HTPR_7394_REMAINING_AI_SPEND_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-08",
  description: "Holds batch, embedding, and long-call spend against the team cap, and turns native web search off on our keys.",
  releaseRisk: { risk: "new", highRisk: "money", reason: "Changes which AI calls can spend Hypertask money and how that spend is held against a team cap.", harmEvidence: { harm: "charge", scenario: "A capped team could be charged for a batch, an embedding, or a long call above the allowance that was held." } },
} as const satisfies FeatureFlagDefinition;
