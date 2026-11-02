import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8263_FULL_SCREEN_CHAT_CLEANUP_FLAG =
  "htpr-8263-full-screen-chat-cleanup";

export default {
  key: HTPR_8263_FULL_SCREEN_CHAT_CLEANUP_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description:
    "Full-screen AI chat matches the approved cleanup: title-only header, mic left of a text Send button, plain placeholder, 4px radii and tighter chat list rows. Off restores the previous header, composer and list spacing.",
  releaseRisk: {
    risk: "small",
    reason:
      "Visual-only change on the /chat surface and the shared chat composer. Off restores the sparkle header, icon Send button, old placeholder and spacing; sending, dictation and session handling are unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
