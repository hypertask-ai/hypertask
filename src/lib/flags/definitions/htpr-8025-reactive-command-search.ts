import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8025_REACTIVE_COMMAND_SEARCH_FLAG = "htpr-8025-reactive-command-search";

export default {
  key: HTPR_8025_REACTIVE_COMMAND_SEARCH_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Command search refreshes when Pages and other commands finish loading, without retyping or reloading.",
  releaseRisk: {
    risk: "small",
    reason: "Refreshes existing command results only; Off restores refresh-on-typing behavior.",
  },
} as const satisfies FeatureFlagDefinition;
