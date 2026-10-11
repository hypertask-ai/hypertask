import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6930_MY_TASKS_KANBAN_REUSE_FLAG = "htpr-6930-my-tasks-kanban-reuse";

export default {
  key: HTPR_6930_MY_TASKS_KANBAN_REUSE_FLAG,
  shippedOn: "2026-10-04",
  description: "My Tasks reuses kanban Save view, sorting, and Ctrl+K pickers with matching checkmarks.",
  kind: "improvement",
} as const satisfies FeatureFlagDefinition;
