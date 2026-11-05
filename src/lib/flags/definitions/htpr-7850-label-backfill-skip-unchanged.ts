import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7850_LABEL_BACKFILL_SKIP_UNCHANGED_FLAG = "htpr-7850-label-backfill-skip-unchanged";

export default {
  key: HTPR_7850_LABEL_BACKFILL_SKIP_UNCHANGED_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-05",
  description: "Skips unchanged tasks already classified by smart label backfills.",
  releaseRisk: {
    risk: "small",
    reason: "Only completed classifications with unchanged inputs and membership are skipped; disabling the flag restores backfill inference.",
  },
} as const satisfies FeatureFlagDefinition;
