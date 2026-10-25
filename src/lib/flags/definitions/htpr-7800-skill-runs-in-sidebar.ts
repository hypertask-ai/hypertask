import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7800_SKILL_RUNS_IN_SIDEBAR_FLAG = "htpr-7800-skill-runs-in-sidebar";

export default {
  key: HTPR_7800_SKILL_RUNS_IN_SIDEBAR_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Picking a skill in a ticket comment runs it in the existing AI chat sidebar with the ticket and comment draft as context.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses the existing sidebar and chat skill execution. Off restores the comment skill writer window.",
  },
} as const satisfies FeatureFlagDefinition;
