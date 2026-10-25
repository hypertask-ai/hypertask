import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7762_CHAT_NEW_SESSION_FOCUS_FLAG = "htpr-7762-chat-new-session-focus";

export default {
  key: HTPR_7762_CHAT_NEW_SESSION_FOCUS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Starting a new full-screen AI chat puts the cursor in the message box after the session is ready.",
  releaseRisk: {
    risk: "small",
    reason: "Restores composer focus only after a full-screen new session succeeds. Off keeps the existing focus behavior; docked chat is unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
