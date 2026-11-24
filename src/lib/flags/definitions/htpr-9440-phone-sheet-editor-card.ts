import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9440_PHONE_SHEET_EDITOR_CARD_FLAG = "htpr-9440-phone-sheet-editor-card";

export default {
  key: HTPR_9440_PHONE_SHEET_EDITOR_CARD_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-22",
  description:
    "On a phone, new-task description text stays inside its card on a tall screen and scrolls there.",
  related: ["htpr-8029-phone-new-task-layout"],
  releaseRisk: {
    risk: "small",
    reason:
      "Phone new-task description scrolls inside the card instead of growing past it. Off restores the previous editor height. Desktop is unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
