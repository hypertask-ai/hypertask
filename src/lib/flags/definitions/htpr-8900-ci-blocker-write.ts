import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8900_CI_BLOCKER_WRITE_FLAG = "htpr-8900-ci-blocker-write";

export default {
  key: HTPR_8900_CI_BLOCKER_WRITE_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-07",
  description: "An agent that can already read a board can file a task and open activity there without a separate membership row.",
  releaseRisk: {
    risk: "small",
    highRisk: "access",
    reason: "Widens agent task and activity writes from a membership row to the read access the agent already has. Off keeps today's membership refusal.",
  },
} as const satisfies FeatureFlagDefinition;
