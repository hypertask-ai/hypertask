import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7027_AGENT_NUDGE_EMAIL_FLAG = "htpr-7027-agent-nudge-email";

export default {
  key: HTPR_7027_AGENT_NUDGE_EMAIL_FLAG,
  kind: "feature",
  shippedOn: "2026-10-09",
  description: "Sends new users one connection nudge 24 hours after signup if no agent has connected yet.",
} as const satisfies FeatureFlagDefinition;
