import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8101_VERCEL_BUDGET_ALERTS_FLAG = "htpr-8101-vercel-budget-alerts";

export default {
  key: HTPR_8101_VERCEL_BUDGET_ALERTS_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-03",
  description: "Vercel budget alerts become one urgent ticket, updated as the spend grows.",
  releaseRisk: {
    risk: "new",
    highRisk: "money",
    reason: "Turns Vercel spend alerts into board tickets and an owner email. It does nothing until the webhook secret is set and the address is in Vercel, so Owner + QA is safe from the first deploy. Off stops ticket filing; removing the address in Vercel stops the alerts.",
  },
} as const satisfies FeatureFlagDefinition;
