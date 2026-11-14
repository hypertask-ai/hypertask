import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8896_SKIP_TAKEN_WORK_FLAG = "htpr-8896-skip-taken-work";

export default {
  key: HTPR_8896_SKIP_TAKEN_WORK_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-07",
  description:
    "Next-task picks leave out an open pull request, a pending owner decision, another agent's active run, and an open recorded blocker. Task context includes that active agent log.",
  releaseRisk: {
    risk: "small",
    reason:
      "A next-task pick no longer returns work that is already running, waiting on an owner decision, blocked, or tied to an open pull request. Asking for a column still returns that column's other tickets. Off restores the previous pick and hides the active agent log from task context.",
  },
} as const satisfies FeatureFlagDefinition;
