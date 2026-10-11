import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7123_WRITER_TICKET_TYPE_FLAG = "htpr-7123-writer-ticket-type";

export default {
  key: HTPR_7123_WRITER_TICKET_TYPE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-11",
  description:
    "The Task Writer tells a defect from a request for new or better behavior, so improvements and features are no longer written up as bugs.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only adds a short rule to the Task Writer instructions; the ticket text and layout stay the same."
  },
} as const satisfies FeatureFlagDefinition;
