import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9282_TEAM_SETTINGS_CHAT_FLAG = "htpr-9282-team-settings-chat";

export default {
  key: HTPR_9282_TEAM_SETTINGS_CHAT_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-15",
  description: "The settings side chat can propose one reversible switch for columns, email notifications, AI providers, existing own keys, skills, webhooks, and management keys. Off keeps those pages manual.",
  releaseRisk: {
    risk: "new",
    highRisk: "access",
    reason: "The side chat can propose team provider, own-key, webhook, and management-key switches. Only the team owner can apply them, after the confirmation card. Off leaves those pages manual.",
    harmEvidence: { harm: "auth-bypass", scenario: "A team member could switch on another team's API key, webhook, or management key and use that access." },
  },
} as const satisfies FeatureFlagDefinition;
