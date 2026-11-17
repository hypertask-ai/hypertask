import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8029_PHONE_NEW_TASK_LAYOUT_FLAG = "htpr-8029-phone-new-task-layout";

export default {
  key: HTPR_8029_PHONE_NEW_TASK_LAYOUT_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-17",
  description:
    "On a phone, the new task sheet starts below the status bar and the dictation row stays at the bottom of the text card, just above the keyboard.",
  related: ["htpr-6556-mobile-description-first"],
  releaseRisk: {
    risk: "small",
    reason:
      "Phone-only layout for the new task sheet. Desktop is unchanged, and Off keeps the current full-screen sheet.",
  },
} as const satisfies FeatureFlagDefinition;
