import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7038_TASK_WRITER_SONNET_FLAG = "htpr-7038-task-writer-sonnet";

export default {
  key: HTPR_7038_TASK_WRITER_SONNET_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-09",
  description: "Pins the app and CLI task writer to Sonnet 5.5 medium for every plan, ignoring saved model choices. Off keeps existing selection.",
} as const satisfies FeatureFlagDefinition;
