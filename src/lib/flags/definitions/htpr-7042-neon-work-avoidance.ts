import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7042_NEON_WORK_AVOIDANCE_FLAG = "htpr-7042-neon-work-avoidance";

export default {
  key: HTPR_7042_NEON_WORK_AVOIDANCE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-09",
  description: "Avoids repeated database reads in daily cycle scans, server flag checks and quiet native agent heartbeats without changing deadlines or output.",
} as const satisfies FeatureFlagDefinition;
