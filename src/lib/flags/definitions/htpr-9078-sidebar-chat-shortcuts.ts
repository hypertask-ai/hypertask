import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9078_SIDEBAR_CHAT_SHORTCUTS_FLAG = "htpr-9078-sidebar-chat-shortcuts";

export default {
  key: HTPR_9078_SIDEBAR_CHAT_SHORTCUTS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-22",
  description:
    "Keys typed in the sidebar agent chat stay in the chat box. The shortcuts list does not open while you type, and when you open it on purpose it sits beside the chat instead of covering it.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only the chat box in the AI sidebar ignores page shortcuts while it is focused, and the shortcuts list shifts left by the open chat width. Off restores shortcuts opening over the chat.",
  },
} as const satisfies FeatureFlagDefinition;
