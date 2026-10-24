import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7683_AI_CHAT_TICKET_ROWS_FLAG = "htpr-7683-ai-chat-ticket-rows";

export default {
  key: HTPR_7683_AI_CHAT_TICKET_ROWS_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description: "Shows compact, grouped ticket rows in AI chat answers, with current status, assignees and priority.",
  releaseRisk: {
    risk: "small",
    reason: "Read-only ticket rows reuse existing cells and recheck board access before display; flag Off retains text answers.",
  },
} as const satisfies FeatureFlagDefinition;
