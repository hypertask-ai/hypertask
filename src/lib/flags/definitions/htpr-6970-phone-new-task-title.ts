import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6970_PHONE_NEW_TASK_TITLE_FLAG = "htpr-6970-phone-new-task-title";

export default {
  key: HTPR_6970_PHONE_NEW_TASK_TITLE_FLAG,
  shippedOn: "2026-10-06",
  description: "Restores the phone New Task title field's height and tap target when its collapsed section is expanded.",
  kind: "bugfix",
} as const satisfies FeatureFlagDefinition;
