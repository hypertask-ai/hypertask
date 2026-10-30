import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8197_NO_EVIDENCE_FEEDBACK_FLAG = "htpr-8197-no-evidence-feedback";

export default {
  key: HTPR_8197_NO_EVIDENCE_FEEDBACK_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-30",
  description: "An agent's hand-filed failed-call report that names only a tool, with no HTTP status, error code or field, no longer opens a Bugs ticket; the reply asks for the status and error code instead.",
  releaseRisk: {
    risk: "small",
    reason: "Only skips opening a new ticket for a report nobody can act on; a report with a status, error code or field, and every other category, still files; an already open ticket still counts repeats; Off keeps today's reports.",
  },
} as const satisfies FeatureFlagDefinition;
