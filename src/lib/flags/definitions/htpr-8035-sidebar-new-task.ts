import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8035_SIDEBAR_NEW_TASK_FLAG = "htpr-8035-sidebar-new-task";

export default {
  key: HTPR_8035_SIDEBAR_NEW_TASK_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Adds a primary desktop sidebar button opening the same New Task window as Ctrl+J.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses the existing New Task window without changing task creation or shortcuts. Off removes only the sidebar button.",
  },
} as const satisfies FeatureFlagDefinition;
