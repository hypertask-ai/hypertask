import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7350_CARD_TITLE_WRAP_FLAG = "htpr-7350-card-title-wrap";

export default {
  key: HTPR_7350_CARD_TITLE_WRAP_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-19",
  description: "Board card titles wrap between words instead of splitting words like \"tha t\" or \"bo ard\"; only a word too long for the card, such as a long link, still breaks.",
  releaseRisk: {
    "risk": "small",
    "reason": "Some card titles wrap one word earlier, so a few cards can be one line taller."
  },
} as const satisfies FeatureFlagDefinition;
