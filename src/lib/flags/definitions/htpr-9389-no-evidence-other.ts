import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9389_NO_EVIDENCE_OTHER_FLAG = "htpr-9389-no-evidence-other";

export default {
  key: HTPR_9389_NO_EVIDENCE_OTHER_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-16",
  description: "A hand-filed report that names only a tool, with no HTTP status, error code, field or kept note, no longer opens a feedback ticket when its category is the default other. The reply asks for the status and error code instead, as a failed-call report already does.",
  releaseRisk: {
    risk: "small",
    reason: "Only skips opening a ticket nobody can act on. Any report with a status, error code, field or kept note still files, every other category still files, and an already open ticket still counts repeats. Off keeps today's reports.",
  },
} as const satisfies FeatureFlagDefinition;
