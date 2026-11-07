import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8786_PICKER_SKIPS_OTHER_AGENTS_FLAG =
  "htpr-8786-picker-skips-other-agents";

export default {
  key: HTPR_8786_PICKER_SKIPS_OTHER_AGENTS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-06",
  description:
    "An agent's next-task pick skips tickets already assigned to a different agent, including Doing and In Progress.",
  releaseRisk: {
    risk: "small",
    reason:
      "Narrows one agent's next-task results so another agent's assigned tickets stay out; unassigned tickets, that agent's own tickets, and human-only assignments stay available, and Off restores the previous list.",
  },
} as const satisfies FeatureFlagDefinition;
