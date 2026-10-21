import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7316_CHAT_SCOPE_TICKET_FLAG = "htpr-7316-chat-scope-ticket";

export default {
  key: HTPR_7316_CHAT_SCOPE_TICKET_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description: "Adds Current ticket to the docked AI chat scope while a ticket is open, using its title, description and comments.",
  releaseRisk: {
    risk: "new",
    reason: "Adds an opt-in ticket-only chat context without changing existing ticket read permissions or the default board scope.",
  },
} as const satisfies FeatureFlagDefinition;
