import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7318_TICKET_CHAT_REMINDER_FLAG = "htpr-7318-ticket-chat-reminder";

export default {
  key: HTPR_7318_TICKET_CHAT_REMINDER_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Shows your three most recent AI chat threads about a ticket above its comments, with one-click resume. Only you see your threads.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses the existing viewer-private ticket session list and chat resume action. Off hides the reminder without changing chats or comments.",
  },
} as const satisfies FeatureFlagDefinition;
