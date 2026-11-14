import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8737_BULK_MOVE_BOARD_FLAG = "htpr-8737-bulk-move-board";

export default {
  key: HTPR_8737_BULK_MOVE_BOARD_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-05",
  description: "Move selected board tickets to another board.",
  releaseRisk: {
    risk: "new",
    highRisk: "data-deletion",
    harmEvidence: {
      harm: "permanent-deletion",
      scenario: "A board move calls the existing moveToDifferentBoard cleanup, which permanently deletes the drafts and reminders of every moved ticket tree with no undo. The bulk route applies that same cleanup to as many as 500 selected trees in one action, so one confirmation can delete far more than a single move.",
    },
    reason: "Bulk moves reuse the existing per-tree board move, its write permissions and its cleanup, and stay behind an Owner + QA flag.",
  },
} as const satisfies FeatureFlagDefinition;
