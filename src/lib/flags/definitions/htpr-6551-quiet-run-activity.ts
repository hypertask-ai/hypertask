import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6551_QUIET_RUN_ACTIVITY_FLAG = "htpr-6551-quiet-run-activity";

export default {
  key: HTPR_6551_QUIET_RUN_ACTIVITY_FLAG,
  shippedOn: "2026-09-17",
  description:
    "Lets agent runtimes open and close ticket runs, and keeps passive run updates behind the task history toggle while questions stay visible.",
  releaseRisk: {
    "risk": "small",
    "reason": "Routine agent progress stays in task history while important questions remain visible."
  },
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
