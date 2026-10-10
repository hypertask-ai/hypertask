import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7072_DECISION_INBOX_FLAG = "htpr-7072-decision-inbox";

export default {
  key: HTPR_7072_DECISION_INBOX_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-10",
  description: "Adds a Decisions list to the Inbox with everything waiting on you: review-column tickets, open Question comments that mention you, and unreleased feature flags.",
  releaseRisk: {
    "risk": "new",
    "reason": "The Inbox gains a Decisions panel above the notifications; with the flag off nothing changes."
  },
} as const satisfies FeatureFlagDefinition;
