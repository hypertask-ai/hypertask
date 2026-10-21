import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7313_CTRLJ_ALWAYS_BOARD_CHIP_FLAG = "htpr-7313-ctrlj-always-board-chip";

export default {
  key: HTPR_7313_CTRLJ_ALWAYS_BOARD_CHIP_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description: "Ctrl+J New Task always shows the target board chip as soon as it opens, on boards, tickets, the inbox and every other page.",
  releaseRisk: {
    risk: "small",
    reason: "Shows the existing Ctrl+J board chip in every view; which board the task goes to is unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
