import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7260_KANBAN_SELECT_ALL_FLAG = "htpr-7260-kanban-select-all";

export default {
  key: HTPR_7260_KANBAN_SELECT_ALL_FLAG,
  shippedOn: "2026-10-15",
  kind: "feature",
  releaseRisk: {
    risk: "new",
    reason: "Adds board-wide selection, selected-task commands first, and bulk action shortcuts on the Kanban bar.",
  },
  description: "Select all visible Kanban cards or one column, prioritize selected-task commands, and use quick bulk actions on the selection bar.",
} as const satisfies FeatureFlagDefinition;
