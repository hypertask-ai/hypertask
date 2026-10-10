import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7054_CTRLJ_DUE_DATE_FLAG = "htpr-7054-ctrlj-due-date";

export default {
  key: HTPR_7054_CTRLJ_DUE_DATE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-10",
  description:
    "Sets the task due date from an explicit deadline in the Ctrl+J task writer note, using the user's local date and time zone.",
  releaseRisk: {
    "risk": "small",
    "reason": "An explicit deadline in a Ctrl+J task note sets the new task's due date using the user's local date and time zone."
  },
} as const satisfies FeatureFlagDefinition;
