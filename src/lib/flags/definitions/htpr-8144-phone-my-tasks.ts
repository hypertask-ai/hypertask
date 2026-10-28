import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8144_PHONE_MY_TASKS_FLAG = "htpr-8144-phone-my-tasks";

export default {
  key: HTPR_8144_PHONE_MY_TASKS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-28",
  description: "Keep phone My Tasks ticket IDs and titles in separate columns, fit header controls on one row and leave the last task clear of Back. Desktop stays unchanged.",
  releaseRisk: {
    risk: "small",
    reason: "Phone-only styles on the existing My Tasks table. No task data or actions change; Off restores the previous layout.",
  },
} as const satisfies FeatureFlagDefinition;
