import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8905_SHARED_TICKET_WRITING_FLAG = "htpr-8905-shared-ticket-writing";

export default {
  key: HTPR_8905_SHARED_TICKET_WRITING_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-11",
  description: "A new ticket saved from the app uses the same writing rules as the agent tools. Off lets that app create save text the agent tools still refuse.",
  releaseRisk: {
    risk: "small",
    reason: "Only a new ticket written by an agent on the app create route is checked. Human creates and edits of tickets that already exist stay as they are.",
  },
} as const satisfies FeatureFlagDefinition;
