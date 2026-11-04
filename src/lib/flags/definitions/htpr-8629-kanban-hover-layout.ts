import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8629_KANBAN_HOVER_LAYOUT_FLAG = "htpr-8629-kanban-hover-layout";

export default {
  key: HTPR_8629_KANBAN_HOVER_LAYOUT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-04",
  description: "Keep Kanban card content stationary when the selection checkbox appears on hover.",
  releaseRisk: {
    risk: "small",
    reason: "Moves the hover checkbox into the existing gutter without changing selection behavior. Off restores the previous layout.",
  },
} as const satisfies FeatureFlagDefinition;
