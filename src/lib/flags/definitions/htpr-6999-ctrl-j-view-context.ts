import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6999_CTRL_J_VIEW_CONTEXT_FLAG = "htpr-6999-ctrl-j-view-context";

export default {
  key: HTPR_6999_CTRL_J_VIEW_CONTEXT_FLAG,
  shippedOn: "2026-10-07",
  description: "The Ctrl+J AI ticket writer inherits the open board view's labels, assignees, priority and size for new tickets on that board without replacing explicit values.",
  kind: "bugfix",
} as const satisfies FeatureFlagDefinition;
