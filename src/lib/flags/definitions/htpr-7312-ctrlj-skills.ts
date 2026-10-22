import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7312_CTRLJ_SKILLS_FLAG = "htpr-7312-ctrlj-skills";

export default {
  key: HTPR_7312_CTRLJ_SKILLS_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description: "Ctrl+J New Task invokes available /skill templates and removes recognized tokens from the note sent to the task writer.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses the task writer's existing user and board skill resolver; unknown tokens and flag-off requests stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
