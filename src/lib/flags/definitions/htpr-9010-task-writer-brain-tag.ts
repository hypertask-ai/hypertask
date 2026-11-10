import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9010_TASK_WRITER_BRAIN_TAG_FLAG = "htpr-9010-task-writer-brain-tag";

export default {
  key: HTPR_9010_TASK_WRITER_BRAIN_TAG_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description: "Task Writer picks exactly one brain label on boards that have brain labels, without the user naming tags. Needs htpr-7513-writer-project-labels.",
  related: ["htpr-7513-writer-project-labels"],
  releaseRisk: {
    risk: "small",
    reason: "Only adds one existing board label to new Task Writer tickets on boards that already have brain labels. Off keeps today's label behavior.",
  },
} as const satisfies FeatureFlagDefinition;
