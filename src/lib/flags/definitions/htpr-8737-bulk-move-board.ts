import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8737_BULK_MOVE_BOARD_FLAG = "htpr-8737-bulk-move-board";

export default {
  key: HTPR_8737_BULK_MOVE_BOARD_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-05",
  description: "Move selected board tickets to another board.",
  releaseRisk: { risk: "new", reason: "Bulk moves reuse existing per-tree authorization." },
} as const satisfies FeatureFlagDefinition;
