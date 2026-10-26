import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7838_CONFLICT_NO_FEEDBACK_FLAG = "htpr-7838-conflict-no-feedback";

export default {
  key: HTPR_7838_CONFLICT_NO_FEEDBACK_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "A tool call that gets a 409 conflict (request already in progress or ticket busy) no longer files an automatic AI feedback ticket.",
  releaseRisk: {
    risk: "small",
    reason: "Only skips an automatic report for an expected retry-later answer; the tool still returns the same error and 500 or 400 failures still file; Off keeps today's reports.",
  },
} as const satisfies FeatureFlagDefinition;
