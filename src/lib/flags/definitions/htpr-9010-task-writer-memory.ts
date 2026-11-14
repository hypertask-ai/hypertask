import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9010_TASK_WRITER_MEMORY_FLAG = "htpr-9010-task-writer-memory";

export default {
  key: HTPR_9010_TASK_WRITER_MEMORY_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description:
    "When a person saves a new ticket written with Ctrl+J, the board memory sees the raw note (capped at 2,000 characters) and which Task Writer fields they changed before saving, so the writer can learn how the board writes. Off sends nothing.",
  releaseRisk: {
    risk: "small",
    reason: "Nothing visible changes. The signal reaches only boards that already switched board memory on, passes the existing secret and personal data filter, and flag off sends nothing.",
  },
} as const satisfies FeatureFlagDefinition;
