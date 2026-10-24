import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7733_PERSON_ASSIGNMENT_FILTER_FLAG = "htpr-7733-person-assignment-filter";

export default {
  key: HTPR_7733_PERSON_ASSIGNMENT_FILTER_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Person filters in AI chat, CLI and MCP ticket lists match direct assignments, not assignments to that person's agents. Off restores owner-backed agent matching.",
  releaseRisk: {
    risk: "small",
    reason: "Narrows person-assignment filters without changing assignments, board access or stored data.",
  },
} as const satisfies FeatureFlagDefinition;
