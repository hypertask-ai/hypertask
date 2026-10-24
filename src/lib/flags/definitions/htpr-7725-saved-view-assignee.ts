import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7725_SAVED_VIEW_ASSIGNEE_FLAG = "htpr-7725-saved-view-assignee";

export default {
  key: HTPR_7725_SAVED_VIEW_ASSIGNEE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description:
    "Human assignee filters on saved board views exclude agent-only assignments backed by that user. Off restores legacy ANY matching.",
  releaseRisk: {
    risk: "small",
    reason: "Corrects board filtering and saved-view counts without changing assignments or stored views.",
  },
} as const satisfies FeatureFlagDefinition;
