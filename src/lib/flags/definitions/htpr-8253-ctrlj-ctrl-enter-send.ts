import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8253_CTRLJ_CTRL_ENTER_SEND_FLAG = "htpr-8253-ctrlj-ctrl-enter-send";

export default {
  key: HTPR_8253_CTRLJ_CTRL_ENTER_SEND_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description: "In Ctrl+J, Ctrl+Enter sends the note and Enter starts a new paragraph, matching comments and descriptions; the footer hint names Ctrl+Enter.",
  related: ["htpr-7652-ctrlj-enter-queue", "htpr-7675-ctrlj-enter-before-text-renders", "htpr-7307-ctrlj-footer-clickable"],
  releaseRisk: {
    risk: "small",
    reason: "Only moves the send shortcut inside the Ctrl+J composer: Enter inserts a line break, Ctrl+Enter sends the same note to the same place. Off restores Enter-to-send.",
  },
} as const satisfies FeatureFlagDefinition;
