import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7848_SUMMARY_ON_VIEW_FLAG = "htpr-7848-summary-on-view";

export default {
  key: HTPR_7848_SUMMARY_ON_VIEW_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-11",
  description:
    "Ticket changes only mark the AI summary out of date. The summary runs when someone opens the ticket, at most once a minute per ticket. A Stripe checkout marks the team's tickets out of date instead of generating summaries. Off restores the scheduled runs.",
  releaseRisk: {
    risk: "new",
    reason:
      "Changes when paid summary calls happen, so a summary can show an older version until someone opens the ticket. Off restores the scheduled runs.",
    highRisk: "money",
    harmEvidence: {
      harm: "charge",
      scenario:
        "A team on the metered AI allowance can be charged for a summary run started by a page view it did not trigger, because the paid call now follows whoever opens a stale ticket.",
    },
  },
} as const satisfies FeatureFlagDefinition;
