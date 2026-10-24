import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7702_PHONE_CHAT_LIST_FLAG = "htpr-7702-phone-chat-list";

export default {
  key: HTPR_7702_PHONE_CHAT_LIST_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Keeps the phone conversation list above the active chat composer so typing taps cannot select another conversation.",
  releaseRisk: {
    risk: "small",
    reason: "Only caps the existing phone list height. Off restores viewport-only sizing; desktop sizing stays unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
