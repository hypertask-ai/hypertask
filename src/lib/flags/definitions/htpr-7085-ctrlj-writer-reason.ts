import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7085_CTRLJ_WRITER_REASON_FLAG = "htpr-7085-ctrlj-writer-reason";

export default {
  key: HTPR_7085_CTRLJ_WRITER_REASON_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-11",
  description:
    "When the AI writer fails in the Ctrl+J New Task box, the message shows the real reason (such as the monthly AI allowance being used up) instead of a generic unavailable line. Your note is still saved.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only the failure sentence in the saved-task message changes; the note is saved exactly as before."
  },
} as const satisfies FeatureFlagDefinition;
