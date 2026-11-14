import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7779_SKILL_OFFERS_FLAG = "htpr-7779-skill-offers";

export default {
  key: HTPR_7779_SKILL_OFFERS_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-08",
  description: "Offers one skill or board memory rule in AI chat after the same instruction repeats on a board, with the quotes that justify it.",
  releaseRisk: {
    risk: "new",
    reason: "Adds an offer card in AI chat. Off hides the card, stops counting instructions and stops proposing anything.",
  },
} as const satisfies FeatureFlagDefinition;
