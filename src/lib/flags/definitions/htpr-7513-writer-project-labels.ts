import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7513_WRITER_PROJECT_LABELS_FLAG = "htpr-7513-writer-project-labels";

export default {
  key: HTPR_7513_WRITER_PROJECT_LABELS_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-21",
  defaultMode: "EVERYONE",
  description: "Task Writer preserves existing board project labels in composed and chat-created tickets.",
  releaseRisk: {
    risk: "small",
    reason: "Only applies existing board label IDs suggested by Task Writer when no user or view labels are selected; flag off preserves previous behavior.",
  },
} as const satisfies FeatureFlagDefinition;
