import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9030_HTC_COMMAND_SYNONYMS_FLAG = "htpr-9030-htc-command-synonyms";

export default {
  key: HTPR_9030_HTC_COMMAND_SYNONYMS_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-17",
  description:
    "Command palette matches plain-language goals through shipped synonyms and ignores filler words, with no AI call while typing.",
  releaseRisk: {
    risk: "small",
    reason:
      "Adds command matches only. Every existing name and keyword match keeps its score and order. Off restores name and keyword matching alone.",
  },
} as const satisfies FeatureFlagDefinition;
