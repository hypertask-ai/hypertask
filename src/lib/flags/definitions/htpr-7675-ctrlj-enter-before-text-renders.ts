import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7675_CTRLJ_ENTER_BEFORE_TEXT_RENDERS_FLAG = "htpr-7675-ctrlj-enter-before-text-renders";

export default {
  key: HTPR_7675_CTRLJ_ENTER_BEFORE_TEXT_RENDERS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description: "Enter pressed in Ctrl+J right after typing, before the typed note has shown in the box, now waits for the note and then creates the ticket, instead of being ignored.",
  releaseRisk: {
    risk: "small",
    reason: "Only holds an Enter that was ignored before and sends it once the same note shows; typing more cancels it. Off restores the old behaviour where that Enter did nothing.",
  },
} as const satisfies FeatureFlagDefinition;
