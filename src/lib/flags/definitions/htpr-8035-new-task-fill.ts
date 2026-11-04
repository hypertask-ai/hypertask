import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8035_NEW_TASK_FILL_FLAG = "htpr-8035-new-task-fill";

export default {
  key: HTPR_8035_NEW_TASK_FILL_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description:
    "Gives the sidebar New Task button the inverse high-contrast fill the owner approved, so it reads as the one primary action instead of a selected navigation item.",
  releaseRisk: {
    risk: "small",
    reason:
      "Changes one colour pair on the existing button. Placement, size, plus icon, label, Ctrl+J tooltip, click action and the htpr-8035-sidebar-new-task flag stay the same, and Off restores the primary fill.",
  },
} as const satisfies FeatureFlagDefinition;
