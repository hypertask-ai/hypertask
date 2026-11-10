import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8997_ID_ROW_FLAG = "htpr-8997-id-row";

export default {
  key: HTPR_8997_ID_ROW_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description:
    "Restores the ticket ID row in the ticket properties column, above Status, when the HTPR-8991 right column is on.",
  related: ["htpr-8991-right-column"],
  releaseRisk: {
    risk: "small",
    reason: "Brings back an existing row in its old place. Off hides it again under the HTPR-8991 right column.",
  },
} as const satisfies FeatureFlagDefinition;
