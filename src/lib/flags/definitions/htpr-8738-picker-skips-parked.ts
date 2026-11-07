import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8738_PICKER_SKIPS_PARKED_FLAG =
  "htpr-8738-picker-skips-parked";

export default {
  key: HTPR_8738_PICKER_SKIPS_PARKED_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-07",
  description:
    "A default next-task pick skips tickets waiting on a person, a blocker comment, or a review column. Task list includes the waiting person.",
  releaseRisk: {
    risk: "small",
    reason:
      "The default next-task call leaves out parked approval and review tickets. An explicit section request still returns that column. Off restores the old pick and omits the waiting person from task list.",
  },
} as const satisfies FeatureFlagDefinition;
