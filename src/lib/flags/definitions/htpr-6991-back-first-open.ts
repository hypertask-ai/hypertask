import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6991_BACK_FIRST_OPEN_FLAG = "htpr-6991-back-first-open";

export default {
  key: HTPR_6991_BACK_FIRST_OPEN_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-07",
  description: "Clears the previous task immediately on Back or Forward before restoring cached detail or waiting for the destination route.",
} as const satisfies FeatureFlagDefinition;
