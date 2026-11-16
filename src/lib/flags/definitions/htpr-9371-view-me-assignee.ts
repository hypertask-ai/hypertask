import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9371_VIEW_ME_ASSIGNEE_FLAG = "htpr-9371-view-me-assignee";

export default {
  key: HTPR_9371_VIEW_ME_ASSIGNEE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-16",
  description: "A saved view's assignee filter accepts me and resolves it to the agent that asked, so an agent can keep a view of its own tickets instead of its owner's person id. Off restores id-only filters.",
  releaseRisk: {
    risk: "small",
    reason: "Adds one accepted filter value and changes no assignments, board access or stored data.",
  },
} as const satisfies FeatureFlagDefinition;
