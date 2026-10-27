import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7856_SUMMARY_CONTEXT_FLAG = "htpr-7856-summary-context";

export default {
  key: HTPR_7856_SUMMARY_CONTEXT_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-27",
  description: "Uses the stored ticket summary and latest 20 comments in chat and AI mentions. Task Writer keeps its full editing context.",
  releaseRisk: {
    risk: "small",
    reason: "Reduces automatic ticket context; full ticket tools remain available and missing summaries fall back to the description.",
  },
} as const satisfies FeatureFlagDefinition;
