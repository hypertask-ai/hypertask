import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7319_SKILL_CHAT_FOLLOWUP_FLAG = "htpr-7319-skill-chat-followup";

export default {
  key: HTPR_7319_SKILL_CHAT_FOLLOWUP_FLAG,
  kind: "feature",
  shippedOn: "2026-10-23",
  defaultMode: "EVERYONE",
  description: "Explains the invoked Ctrl+J skill and ticket-specific concerns in the first chat message without delaying chat opening.",
  related: ["htpr-7312-ctrlj-skills", "htpr-7317-ctrlj-ticket-questions"],
  releaseRisk: {
    risk: "small",
    reason: "Reuses authorized skill resolution and the existing intro persistence path. Errors restore the generic intro and questions; off preserves Compose behavior.",
  },
} as const satisfies FeatureFlagDefinition;
