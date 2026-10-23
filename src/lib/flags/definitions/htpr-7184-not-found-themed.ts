import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7184_NOT_FOUND_THEMED_FLAG = "htpr-7184-not-found-themed";

export default {
  key: HTPR_7184_NOT_FOUND_THEMED_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-13",
  description: "The not-found page uses the theme's own background and text colours, so it is readable in Graphite and AMOLED.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes the colours of the 404 page; the same text shows either way.",
  },
} as const satisfies FeatureFlagDefinition;
