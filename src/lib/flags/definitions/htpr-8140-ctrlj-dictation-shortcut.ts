import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8140_CTRLJ_DICTATION_SHORTCUT_FLAG = "htpr-8140-ctrlj-dictation-shortcut";

export default {
  key: HTPR_8140_CTRLJ_DICTATION_SHORTCUT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-28",
  description: "Ctrl+Shift+D starts dictation in the Ctrl+J New Task writer, using Cmd on Apple devices.",
  releaseRisk: {
    risk: "small",
    reason: "Routes the existing dictation shortcut to the active New Task microphone; mouse controls and recording behavior stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
