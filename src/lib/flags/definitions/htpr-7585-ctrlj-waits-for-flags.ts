import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7585_CTRLJ_WAITS_FOR_FLAGS_FLAG = "htpr-7585-ctrlj-waits-for-flags";

export default {
  key: HTPR_7585_CTRLJ_WAITS_FOR_FLAGS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "Stops Ctrl+J and Cmd+J on a board from opening the legacy New Task page before the compose task writer is ready.",
  releaseRisk: {
    risk: "small",
    reason: "Only holds the legacy board task shortcut until the compose writer is ready. Off restores the existing shortcut behavior.",
  },
} as const satisfies FeatureFlagDefinition;
