import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7307_CTRLJ_FOOTER_CLICKABLE_FLAG = "htpr-7307-ctrlj-footer-clickable";

export default {
  key: HTPR_7307_CTRLJ_FOOTER_CLICKABLE_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description: "Ctrl+J footer labels can be clicked to send, attach files, search, choose a board or close the window.",
  releaseRisk: {
    risk: "small",
    reason: "Makes existing shortcut labels clickable using their existing actions without changing keyboard behavior or task creation.",
  },
} as const satisfies FeatureFlagDefinition;
