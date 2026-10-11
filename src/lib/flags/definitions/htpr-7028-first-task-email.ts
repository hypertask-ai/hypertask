import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7028_FIRST_TASK_EMAIL_FLAG = "htpr-7028-first-task-email";

export default {
  key: HTPR_7028_FIRST_TASK_EMAIL_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-09",
  description: "Emails a board owner once when their agent first finishes a task, with links to review the work and invite a teammate.",
} as const satisfies FeatureFlagDefinition;
