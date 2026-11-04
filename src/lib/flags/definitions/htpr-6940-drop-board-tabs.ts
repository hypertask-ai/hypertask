import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6940_DROP_BOARD_TABS_FLAG = "htpr-6940-drop-board-tabs";

export default {
  key: HTPR_6940_DROP_BOARD_TABS_FLAG,
  kind: "improvement",
  shippedOn: "2026-11-04",
  defaultMode: "EVERYONE",
  description: "My Tasks shows only its saved view tabs; boards are picked with Scope and seen with Group: Board.",
  releaseRisk: { risk: "small", reason: "Removes a second tab row that repeated Scope and Group: Board; every board and its counts stay reachable through the view controls and the board grouped sections. Off restores the row." },
} as const satisfies FeatureFlagDefinition;
