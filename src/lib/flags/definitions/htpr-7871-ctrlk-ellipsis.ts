import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7871_CTRLK_ELLIPSIS_FLAG = "htpr-7871-ctrlk-ellipsis";

export default {
  key: HTPR_7871_CTRLK_ELLIPSIS_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-09",
  description:
    "The Ctrl+K search box placeholder ends with a real ellipsis character instead of three full stops, like the command names in the same menu.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only changes one punctuation character in the Ctrl+K placeholder text. Search and every shortcut work the same, and Off restores the three full stops.",
  },
} as const satisfies FeatureFlagDefinition;
