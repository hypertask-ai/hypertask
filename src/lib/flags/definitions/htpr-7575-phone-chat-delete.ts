import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7575_PHONE_CHAT_DELETE_FLAG = "htpr-7575-phone-chat-delete";

export default {
  key: HTPR_7575_PHONE_CHAT_DELETE_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-24",
  description: "Phone AI chat history shows the desktop trash action on each row, with the same confirmation before deletion.",
  releaseRisk: {
    risk: "small",
    highRisk: "data-deletion",
    reason: "Makes existing chat deletion reachable on phones. Reuses the desktop confirmation and authenticated delete action; Off hides the phone control.",
  },
} as const satisfies FeatureFlagDefinition;
