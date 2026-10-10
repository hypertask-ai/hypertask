import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7055_CHAT_OVERLAYS_TICKET_FLAG = "htpr-7055-chat-overlays-ticket";

export default {
  key: HTPR_7055_CHAT_OVERLAYS_TICKET_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-11",
  description: "On a ticket page, the AI chat opens over the ticket instead of squeezing it when the window is too narrow for both.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only whether the AI chat sits over or beside a ticket page in narrow windows changes; other pages and the flag-off layout stay the same."
  },
} as const satisfies FeatureFlagDefinition;
