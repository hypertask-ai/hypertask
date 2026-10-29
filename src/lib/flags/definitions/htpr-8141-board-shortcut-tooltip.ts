import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8141_BOARD_SHORTCUT_TOOLTIP_FLAG = "htpr-8141-board-shortcut-tooltip";

export default {
  key: HTPR_8141_BOARD_SHORTCUT_TOOLTIP_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-29",
  description: "The New Task board chip shows its existing keyboard shortcut on hover.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses the shared tooltip and existing shortcut label without changing board selection or composer layout.",
  },
} as const satisfies FeatureFlagDefinition;
