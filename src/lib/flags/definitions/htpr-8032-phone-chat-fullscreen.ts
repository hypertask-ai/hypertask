import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8032_PHONE_CHAT_FULLSCREEN_FLAG = "htpr-8032-phone-chat-fullscreen";

export default {
  key: HTPR_8032_PHONE_CHAT_FULLSCREEN_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-15",
  description: "On a phone, the AI chat opens full screen and the board picker is one small chip in the header. Desktop stays the same.",
  releaseRisk: {
    risk: "small",
    reason: "Only rearranges the existing phone chat. Off restores the sheet and the large board picker.",
  },
} as const satisfies FeatureFlagDefinition;
