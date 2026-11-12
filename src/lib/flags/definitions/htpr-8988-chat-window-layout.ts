import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8988_CHAT_WINDOW_LAYOUT_FLAG = "htpr-8988-chat-window-layout";

export default {
  key: HTPR_8988_CHAT_WINDOW_LAYOUT_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-11",
  description: "Open floating chats beside each other and keep minimized chats together at the bottom. Sidebar chat stays in the sidebar.",
  releaseRisk: {
    risk: "small",
    reason: "Visible chat layout repair stays with Owner and QA until independent comparison passes. Existing conversations and sidebar behavior are unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
