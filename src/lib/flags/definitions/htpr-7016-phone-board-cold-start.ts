import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7016_PHONE_BOARD_COLD_START_FLAG = "htpr-7016-phone-board-cold-start";

export default {
  key: HTPR_7016_PHONE_BOARD_COLD_START_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-08",
  description: "Keeps unused fonts from delaying the existing server-drawn phone board cards. Requires the server first screen.",
} as const satisfies FeatureFlagDefinition;
