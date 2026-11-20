import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9399_ARCHIVED_BOARD_TICKETS_FLAG = "htpr-9399-archived-board-tickets";

export default {
  key: HTPR_9399_ARCHIVED_BOARD_TICKETS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-17",
  description: "Archived boards refuse new tickets and refuse tickets moved into them. Off lets that work land on an archived board again.",
  releaseRisk: {
    risk: "small",
    reason: "Only writes to a board the owner already archived are refused, and the refusal names the board. Active boards behave as before, so reverting the change or switching the flag off restores the old behaviour.",
  },
} as const satisfies FeatureFlagDefinition;
