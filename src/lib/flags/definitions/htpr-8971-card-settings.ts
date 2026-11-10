import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8971_CARD_SETTINGS_FLAG = "htpr-8971-card-settings";

export default {
  key: HTPR_8971_CARD_SETTINGS_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description: "Board cards show only the name and people until you switch parts on. Ctrl+K on the board lists Card settings right under Board settings, which opens a Profile page with one switch per card part: ticket number, inbox icon, comments, sub-tasks, priority, size, due date, tags, staleness and blocked edge. Off keeps today's full card.",
  releaseRisk: {
    risk: "small",
    reason: "Only what each person sees on their own board cards changes. Nothing on the ticket is removed, and each part comes back with one switch.",
  },
} as const satisfies FeatureFlagDefinition;
