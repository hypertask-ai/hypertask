import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7472_TASK_TEMPLATES_FLAG = "htpr-7472-task-templates";

export default {
  key: HTPR_7472_TASK_TEMPLATES_FLAG,
  kind: "feature",
  shippedOn: "2026-10-21",
  defaultMode: "OWNER_AND_QA",
  description: "Edit saved board task templates and write finished, board-informed ideas in one go.",
  releaseRisk: {
    risk: "small",
    reason: "Template updates reuse board access checks; the writer retries placeholder drafts once and flag off preserves existing behavior.",
  },
} as const satisfies FeatureFlagDefinition;
