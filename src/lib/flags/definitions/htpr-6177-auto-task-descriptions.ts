import type { FeatureFlagDefinition } from "../definitions";

export const AUTO_TASK_DESCRIPTIONS_FLAG = "htpr-6177-auto-task-descriptions";

export default {
  key: AUTO_TASK_DESCRIPTIONS_FLAG,
  shippedOn: "2026-09-05",
  description:
    "Drafts a task description from the title while you type, below an empty description.",
  releaseRisk: {
    "risk": "new",
    "reason": "Adds draft task descriptions below the title while a task is being written."
  },
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
