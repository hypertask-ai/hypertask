import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6938_MY_TASKS_ICON_CONTROLS_FLAG = "htpr-6938-my-tasks-icon-controls";

export default {
  key: HTPR_6938_MY_TASKS_ICON_CONTROLS_FLAG,
  shippedOn: "2026-10-04",
  description: "My Tasks uses icon-only controls, visible blue active states, remembered views and board tabs, and overdue tooltips.",
  kind: "improvement",
  releaseRisk: {
    "risk": "small",
    "reason": "Existing My Tasks controls use icons, clearer active states and remembered views."
  },
} as const satisfies FeatureFlagDefinition;
