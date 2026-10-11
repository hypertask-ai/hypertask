import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6997_NEW_TASK_WINDOW_VIEW_CONTEXT_FLAG = "htpr-6997-new-task-window-view-context";

export default {
  key: HTPR_6997_NEW_TASK_WINDOW_VIEW_CONTEXT_FLAG,
  shippedOn: "2026-10-07",
  description: "The New Task window opened with C or Ctrl+J inherits the view's assignees, priority and size without replacing caller values or user selections.",
  kind: "bugfix",
} as const satisfies FeatureFlagDefinition;
