import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7055_CHAT_OVERLAYS_TICKET_FLAG = "htpr-7055-chat-overlays-ticket";

export default {
  key: HTPR_7055_CHAT_OVERLAYS_TICKET_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-11",
  description: "On a ticket page, the AI chat opens over the ticket instead of squeezing it when the window is too narrow for both.",
} as const satisfies FeatureFlagDefinition;
