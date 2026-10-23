import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7652_CTRLJ_ENTER_QUEUE_FLAG = "htpr-7652-ctrlj-enter-queue";

export default {
  key: HTPR_7652_CTRLJ_ENTER_QUEUE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description: "Enter pressed in Ctrl+J while the board list is still loading now waits for the list and then creates the ticket, instead of being ignored.",
  releaseRisk: {
    risk: "small",
    reason: "Only holds an Enter that was ignored before and sends it once when the board list arrives; typing more cancels it. Off restores the old behaviour where that Enter did nothing.",
  },
} as const satisfies FeatureFlagDefinition;
