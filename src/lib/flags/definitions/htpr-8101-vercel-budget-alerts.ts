import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8101_VERCEL_BUDGET_ALERTS_FLAG = "htpr-8101-vercel-budget-alerts";

export default {
  key: HTPR_8101_VERCEL_BUDGET_ALERTS_FLAG,
  kind: "improvement",
  shippedOn: "2026-11-03",
  releaseRisk: {
    "risk": "small",
    "reason": "The intake only files a board ticket and emails the owner. It needs a Vercel webhook secret before it does anything, and removing the address in Vercel stops it.",
  },
  description: "Vercel budget alerts become one urgent ticket, updated as spend grows.",
} as const satisfies FeatureFlagDefinition;
