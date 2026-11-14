import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8991_RIGHT_COLUMN_FLAG = "htpr-8991-right-column";

export default {
  key: HTPR_8991_RIGHT_COLUMN_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description:
    "Ticket detail right column shows only filled fields, keeps Status and Project, adds one quiet Add field link that opens Ctrl+K with the empty fields, and moves the ticket ID beside the title.",
  releaseRisk: {
    risk: "new",
    reason:
      "Visible UI change to the ticket detail column under design review. Off keeps every row, the ID row and the empty placeholders exactly as today.",
  },
} as const satisfies FeatureFlagDefinition;
