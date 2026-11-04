import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8639_CALENDAR_PICKER_SHORTCUT_FLAG = "htpr-8639-calendar-picker-shortcut";

export default {
  key: HTPR_8639_CALENDAR_PICKER_SHORTCUT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-04",
  description: "Keeps the calendar due date shortcut out of the picker search field.",
  releaseRisk: {
    risk: "small",
    reason: "Only prevents the default action of the calendar due date shortcut when a task is selected; off restores the previous behavior.",
  },
} as const satisfies FeatureFlagDefinition;
