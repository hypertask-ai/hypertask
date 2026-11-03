import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8243_BOARD_SWITCH_ADDRESS_FLAG =
  "htpr-8243-board-switch-address";

export default {
  key: HTPR_8243_BOARD_SWITCH_ADDRESS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description:
    "A board click keeps its own address: the URL tidy-up waits while a newer board switch is still landing. Off restores the old write.",
  releaseRisk: {
    risk: "small",
    reason:
      "Skips one URL tidy-up write until the clicked board lands, at most 30 seconds. No board, view or task data changes. Off restores the previous write.",
  },
} as const satisfies FeatureFlagDefinition;
