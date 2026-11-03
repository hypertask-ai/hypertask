import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8250_NEW_SUBTASK_BUTTON_FLAG = "htpr-8250-new-subtask-button";

export default {
  key: HTPR_8250_NEW_SUBTASK_BUTTON_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description: "Adds a New sub-task button to the sub-task modal, so creating one no longer needs a name that matches nothing.",
  releaseRisk: {
    risk: "small",
    reason: "Adds one button beside the existing search list; searching, linking and Enter-to-create stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
