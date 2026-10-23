import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7559_ENTER_RUNS_SEARCH_FLAG = "htpr-7559-enter-runs-search";

export default {
  key: HTPR_7559_ENTER_RUNS_SEARCH_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "Enter runs regular search for plain text, while ArrowDown then Enter asks AI and explicit operator completions still accept suggestions.",
  releaseRisk: {
    risk: "small",
    reason: "Changes only desktop search suggestion selection and keyboard submission; Off restores the previous selection behavior.",
  },
} as const satisfies FeatureFlagDefinition;
