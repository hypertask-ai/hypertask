import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6891_PHONE_TASK_WRITER_SHEET_FLAG = "htpr-6891-phone-task-writer-sheet";

export default {
  key: HTPR_6891_PHONE_TASK_WRITER_SHEET_FLAG,
  kind: "feature",
  shippedOn: "2026-10-18",
  description: "Lets the phone New Task writer fill its sheet above the keyboard and hides hardware-keyboard hints, without changing the desktop writer.",
  releaseRisk: {
    risk: "new",
    reason: "Changes the phone task writer height and scrolling while the keyboard is open.",
  },
} as const satisfies FeatureFlagDefinition;
