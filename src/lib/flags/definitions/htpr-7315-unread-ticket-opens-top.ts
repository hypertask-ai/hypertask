import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7315_UNREAD_TICKET_OPENS_TOP_FLAG = "htpr-7315-unread-ticket-opens-top";

export default {
  key: HTPR_7315_UNREAD_TICKET_OPENS_TOP_FLAG,
  kind: "improvement",
  shippedOn: "2026-10-18",
  defaultMode: "OWNER_AND_QA",
  description: "Opens never-read tickets at the description, previously read tickets at the newest comment, and tickets with new comments at the first unread comment.",
  releaseRisk: {
    risk: "small",
    reason: "Changes initial ticket scrolling on desktop and phone while preserving scroll preferences and comment links.",
  },
} as const satisfies FeatureFlagDefinition;
