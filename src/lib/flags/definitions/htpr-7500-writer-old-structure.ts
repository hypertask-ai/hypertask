import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7500_WRITER_OLD_STRUCTURE_FLAG = "htpr-7500-writer-old-structure";

export default {
  key: HTPR_7500_WRITER_OLD_STRUCTURE_FLAG,
  kind: "improvement",
  shippedOn: "2026-10-21",
  defaultMode: "EVERYONE",
  description:
    "Task writer keeps the board's complete ticket structure, source-grounded controls and ICE reasons with web-writing brevity.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes task-writer prompts; flag off preserves the previous prompts and output extraction stays unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
