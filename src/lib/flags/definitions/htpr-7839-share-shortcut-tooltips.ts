import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7839_SHARE_SHORTCUT_TOOLTIPS_FLAG = "htpr-7839-share-shortcut-tooltips";

export default {
  key: HTPR_7839_SHARE_SHORTCUT_TOOLTIPS_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "Shows each Share Task option's keyboard shortcut in a hover tooltip.",
  releaseRisk: {
    risk: "small",
    reason: "Only adds hover tooltips to the Share Task rows; Off hides them and changes nothing else.",
  },
} as const satisfies FeatureFlagDefinition;
