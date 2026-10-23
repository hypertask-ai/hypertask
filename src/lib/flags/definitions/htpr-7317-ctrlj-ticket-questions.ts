import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7317_CTRLJ_TICKET_QUESTIONS_FLAG = "htpr-7317-ctrlj-ticket-questions";

export default {
  key: HTPR_7317_CTRLJ_TICKET_QUESTIONS_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description: "After Ctrl+J creates a ticket, the AI chat sidebar shows 2 to 4 questions and improvement ideas written for that ticket.",
  releaseRisk: {
    risk: "small",
    reason: "Adds suggestion chips under the Ctrl+J intro message; switching off restores the plain intro.",
  },
} as const satisfies FeatureFlagDefinition;
