import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8628_KANBAN_STICKY_HEADER_FLAG = "htpr-8628-kanban-sticky-header";

export default {
  key: HTPR_8628_KANBAN_STICKY_HEADER_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-05",
  description: "Keeps Kanban column headings above cards while scrolling.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes the stacking order of Kanban headings; Off restores the previous order.",
  },
} as const satisfies FeatureFlagDefinition;
