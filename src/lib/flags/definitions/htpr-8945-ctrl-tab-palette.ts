import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8945_CTRL_TAB_PALETTE_FLAG = "htpr-8945-ctrl-tab-palette";

export default {
  key: HTPR_8945_CTRL_TAB_PALETTE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description:
    "In Ctrl+J and Ctrl+K, Tab switches between Search and New Task instead of focusing the plus menu, mic, or other composer controls.",
  releaseRisk: {
    risk: "small",
    reason:
      "Tab alone switches palette tabs on desktop. Plus, mic, Send and board chip stay reachable by mouse and existing shortcuts, and Off restores today's Tab order.",
  },
} as const satisfies FeatureFlagDefinition;
