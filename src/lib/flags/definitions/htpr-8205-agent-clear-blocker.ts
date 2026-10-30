import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8205_AGENT_CLEAR_BLOCKER_FLAG = "htpr-8205-agent-clear-blocker";

export default {
  key: HTPR_8205_AGENT_CLEAR_BLOCKER_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-30",
  description: "An agent that clears a ticket's blocker marker leaves a note with who and why, and the ticket leaves the person's Decisions list at once.",
  releaseRisk: {
    risk: "small",
    reason: "Adds a note and a Decisions filter to an existing clear that agents could already send; turning it off restores today's behavior.",
  },
} as const satisfies FeatureFlagDefinition;
