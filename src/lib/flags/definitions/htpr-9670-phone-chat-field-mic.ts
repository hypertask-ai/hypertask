import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9670_PHONE_CHAT_FIELD_MIC_FLAG = "htpr-9670-phone-chat-field-mic";

export default {
  key: HTPR_9670_PHONE_CHAT_FIELD_MIC_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-25",
  description:
    "The phone AI chat Message field shows its dictation mic in the field row, right-bound, and the recording row takes that row while dictating.",
  releaseRisk: {
    risk: "small",
    reason:
      "Moves the existing chat mic inside the phone composer only. Off keeps the mic in the action row, and desktop is untouched.",
  },
} as const satisfies FeatureFlagDefinition;
