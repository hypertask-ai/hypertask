import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8265_TASK_SHORTCUTS_WRITER_MODEL_FLAG =
  "htpr-8265-task-shortcuts-writer-model";

export default {
  key: HTPR_8265_TASK_SHORTCUTS_WRITER_MODEL_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description:
    "N opens quick add in the column you point at, Shift+C stops duplicating it, the column + shows N, and the Ctrl+J task writer has the shared model picker.",
  releaseRisk: {
    risk: "small",
    reason:
      "Keyboard shortcuts and one composer control; task creation, the writer request and every other shortcut keep their current behaviour. Off restores today's shortcuts and hides the picker.",
  },
} as const satisfies FeatureFlagDefinition;
