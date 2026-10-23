import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7534_WRITING_QUESTIONS_FLAG = "htpr-7534-writing-questions";

export default {
  key: HTPR_7534_WRITING_QUESTIONS_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "After Ctrl+J creates a ticket, suggested questions improve its writing and format instead of discussing its subject.",
  releaseRisk: {
    risk: "small",
    reason: "Changes only the new-ticket question prompt; switching off restores the existing subject-oriented suggestions without changing chat or ticket editing.",
  },
} as const satisfies FeatureFlagDefinition;
