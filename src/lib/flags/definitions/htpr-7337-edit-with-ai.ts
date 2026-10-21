import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7337_EDIT_WITH_AI_FLAG = "htpr-7337-edit-with-ai";

export default {
  key: HTPR_7337_EDIT_WITH_AI_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-18",
  description: "Opens ticket AI actions in a fresh chat with suggestions for editing the current task in place.",
  releaseRisk: {
    risk: "new",
    reason: "Ticket and editor AI actions open the existing sidebar chat instead of the inline writer.",
  },
} as const satisfies FeatureFlagDefinition;
