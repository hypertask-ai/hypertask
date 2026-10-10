import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7049_RELOAD_AFTER_IMAGE_CHAT_FLAG = "htpr-7049-reload-after-image-chat";

export default {
  key: HTPR_7049_RELOAD_AFTER_IMAGE_CHAT_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-09",
  description: "Refreshes the open task after an AI chat turn completes, including requests with image attachments, without relying on websocket delivery.",
  releaseRisk: {
    "risk": "small",
    "reason": "The open ticket refreshes after AI chat edits it, including requests with image attachments."
  },
} as const satisfies FeatureFlagDefinition;
