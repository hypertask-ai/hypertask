import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8987_CHAT_BLOCKER_READ_FLAG = "htpr-8987-chat-blocker-read";

export default {
  key: HTPR_8987_CHAT_BLOCKER_READ_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description:
    "AI chat get_tasks and current-ticket context include open BlockedBy blocker tickets, matching board and list_tasks reads.",
  releaseRisk: {
    risk: "small",
    reason:
      "Adds blocked-by fields to existing chat read tools only when enabled; Off keeps today’s reads without blocker names.",
  },
} as const satisfies FeatureFlagDefinition;
