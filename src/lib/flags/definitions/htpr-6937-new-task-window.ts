import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6937_NEW_TASK_WINDOW_FLAG = "htpr-6937-new-task-window";

export default {
  key: HTPR_6937_NEW_TASK_WINDOW_FLAG,
  shippedOn: "2026-10-04",
  description: "Turns Compose into a larger New Task window with dictation and one Ctrl+J, filling an empty task when opened there. Requires the Compose task writer flag.",
  related: ["htpr-6929-compose-task-writer"],
  releaseRisk: {
    "risk": "new",
    "reason": "The New Task window adds dictation and a revised keyboard-driven task creation flow."
  },
} as const satisfies FeatureFlagDefinition;
