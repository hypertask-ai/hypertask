import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7586_ONE_QUESTIONS_CALL_FLAG = "htpr-7586-one-questions-call";

export default {
  key: HTPR_7586_ONE_QUESTIONS_CALL_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "Skips the unused generic AI questions request while a Ctrl+J ticket's new-ticket questions are pending.",
  related: ["htpr-7317-ctrlj-ticket-questions"],
  releaseRisk: {
    risk: "small",
    reason: "Disables only the unused generic request before the new-ticket intro appears. Off restores both requests without changing the sidebar UI.",
  },
} as const satisfies FeatureFlagDefinition;
