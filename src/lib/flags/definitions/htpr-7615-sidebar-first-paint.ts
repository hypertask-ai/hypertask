import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7615_SIDEBAR_FIRST_PAINT_FLAG = "htpr-7615-sidebar-first-paint";

export default {
  key: HTPR_7615_SIDEBAR_FIRST_PAINT_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description: "Paints the AI chat column and the left rail at their saved size before a ticket page loads, so the ticket does not jump right after it opens.",
  releaseRisk: {
    risk: "small",
    reason: "Only sizes the chat column and rail before the page finishes loading, then hands back to the normal layout; final layout is unchanged. Off restores the old first paint.",
  },
} as const satisfies FeatureFlagDefinition;
