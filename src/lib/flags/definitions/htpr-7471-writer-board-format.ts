import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7471_WRITER_BOARD_FORMAT_FLAG = "htpr-7471-writer-board-format";

export default {
  key: HTPR_7471_WRITER_BOARD_FORMAT_FLAG,
  kind: "feature",
  shippedOn: "2026-10-20",
  defaultMode: "EVERYONE",
  description:
    "Task writer follows the board's instructions, recurring ticket format and custom fields while keeping sections short.",
  releaseRisk: {
    risk: "small",
    reason: "Uses authorized board context and validates optional writer fields against that board before saving; flag off preserves the existing writer.",
  },
} as const satisfies FeatureFlagDefinition;
