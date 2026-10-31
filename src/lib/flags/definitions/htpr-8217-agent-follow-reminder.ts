import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8217_AGENT_FOLLOW_REMINDER_FLAG = "htpr-8217-agent-follow-reminder";

export default {
  key: HTPR_8217_AGENT_FOLLOW_REMINDER_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-30",
  description: "Agents can follow, star and set a reminder on a ticket through MCP.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses the app's own follower, star and reminder writes behind the existing board access checks and write role guard; turning it off stops agent tracking writes without changing a person's.",
  },
} as const satisfies FeatureFlagDefinition;
