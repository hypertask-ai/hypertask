import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8839_EVIDENCE_BOARD_NUMBER_FLAG = "htpr-8839-evidence-board-number";

export default {
  key: HTPR_8839_EVIDENCE_BOARD_NUMBER_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-06",
  description: "Adding evidence to an existing agent-feedback report finds the ticket from the number in its link.",
  releaseRisk: {
    risk: "small",
    reason: "Only evidence attach and list change, and only for a board number on that board. A number that is both a task id and a different board number is refused instead of writing to the wrong ticket. Off keeps today's lookup.",
  },
} as const satisfies FeatureFlagDefinition;
