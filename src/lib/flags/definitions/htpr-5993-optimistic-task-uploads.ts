import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_5993_OPTIMISTIC_TASK_UPLOADS_FLAG = "htpr-5993-optimistic-task-uploads";

export default {
  key: HTPR_5993_OPTIMISTIC_TASK_UPLOADS_FLAG,
  kind: "improvement",
  shippedOn: "2026-09-04",
  description: "Saves new tasks immediately while their attachments continue uploading.",
} as const satisfies FeatureFlagDefinition;
