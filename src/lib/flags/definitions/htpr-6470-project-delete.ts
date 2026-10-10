import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6470_PROJECT_DELETE_FLAG = "htpr-6470-project-delete";

export default {
  key: HTPR_6470_PROJECT_DELETE_FLAG,
  kind: "feature",
  shippedOn: "2026-09-18",
  description:
    "Lets board owners and admins permanently delete a board and its tasks through the Hypertask CLI after explicit confirmation.",
  releaseRisk: {
    "risk": "none",
    "reason": "Adds confirmed board deletion to the command-line tool without changing the app interface."
  },
} as const satisfies FeatureFlagDefinition;
