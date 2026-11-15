import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9244_LOST_FEEDBACK_NOTE_FLAG =
  "htpr-9244-lost-feedback-note";

export default {
  key: HTPR_9244_LOST_FEEDBACK_NOTE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-15",
  description:
    "A hand-filed agent report that names a kind but carries no HTTP status, error code, field or kept note no longer opens a ticket nobody can act on.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only stops opening a new ticket for a report with no usable evidence. A report with a status, error code, field or a kept note still files, and an already open ticket still counts repeats. Off keeps today's reports.",
  },
} as const satisfies FeatureFlagDefinition;
