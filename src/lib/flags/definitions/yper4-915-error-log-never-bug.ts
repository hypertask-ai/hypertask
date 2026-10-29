import type { FeatureFlagDefinition } from "../definitions";

export const YPER4_915_ERROR_LOG_NEVER_BUG_FLAG = "yper4-915-error-log-never-bug";

export default {
  key: YPER4_915_ERROR_LOG_NEVER_BUG_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-29",
  description: "Smart labels never add Bug to a ticket that carries the Error Log label, so error tickets and bug tickets stay apart.",
  releaseRisk: {
    risk: "small",
    reason: "Only withholds one smart label on tickets already tagged Error Log. Every other ticket classifies as before. Off restores the old behavior.",
  },
} as const satisfies FeatureFlagDefinition;
