import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7977_SHORT_TASK_WRITER_FLAG = "htpr-7977-short-task-writer";

export default {
  key: HTPR_7977_SHORT_TASK_WRITER_FLAG,
  kind: "improvement",
  shippedOn: "2026-10-27",
  defaultMode: "EVERYONE",
  description:
    "Task writer keeps ordinary tickets short and uses experiment sections only for A/B tickets whose board rules or matching template request them.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes task-writer writing instructions; flag off preserves existing prompts, board context and output extraction.",
  },
} as const satisfies FeatureFlagDefinition;
