import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9390_UNKEPT_FEEDBACK_NOTE_FLAG = "htpr-9390-unkept-feedback-note";

export default {
  key: HTPR_9390_UNKEPT_FEEDBACK_NOTE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-16",
  description: "A feedback report whose note could not be kept, and that carries no status, error code or field, no longer opens an empty ticket; the caller is asked to report again in plain words.",
  releaseRisk: {
    risk: "small",
    reason: "Only skips opening a new ticket for a report with nothing kept in it. A report with a kept note, a status, an error code or a field still files, a repeat still joins its open ticket, and Off keeps today's empty tickets.",
  },
} as const satisfies FeatureFlagDefinition;
