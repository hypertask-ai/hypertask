import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9302_PHONE_CHAT_DRAWER_FLAG = "htpr-9302-phone-chat-drawer";

export default {
  key: HTPR_9302_PHONE_CHAT_DRAWER_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-15",
  description: "On a phone, the AI chat header opens past chats in a side drawer. Desktop keeps the history menu.",
  releaseRisk: {
    risk: "small",
    reason: "Only the phone history menu moves into a side drawer. Off restores the dropdown. Desktop stays the same.",
  },
} as const satisfies FeatureFlagDefinition;
