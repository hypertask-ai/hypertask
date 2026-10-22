import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7588_BOARD_SHORTCUT_FROM_DEVICE_FLAG = "htpr-7588-board-shortcut-from-device";

export default {
  key: HTPR_7588_BOARD_SHORTCUT_FROM_DEVICE_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "g then b opens the board at once when the board list already on the device contains it, and refreshes that list in the background instead of waiting for it.",
  releaseRisk: {
    risk: "small",
    reason: "The same board is chosen from the same list contents; only the wait for a fresh list is skipped when the board is already in it. Off restores waiting for the list on every press.",
  },
} as const satisfies FeatureFlagDefinition;
