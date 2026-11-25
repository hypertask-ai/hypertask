import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9300_COMPOSE_CACHED_OPEN_FLAG = "htpr-9300-compose-cached-open";

export default {
  key: HTPR_9300_COMPOSE_CACHED_OPEN_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-22",
  description:
    "After Ctrl+J saves a new task, the saved ticket opens from the copy already on screen instead of waiting for a fresh page load.",
  releaseRisk: {
    risk: "small",
    reason:
      "The saved title and description stay the same. Off opens the ticket with the previous full page load.",
  },
} as const satisfies FeatureFlagDefinition;
