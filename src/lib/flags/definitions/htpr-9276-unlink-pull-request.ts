import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9276_UNLINK_PULL_REQUEST_FLAG = "htpr-9276-unlink-pull-request";

export default {
  key: HTPR_9276_UNLINK_PULL_REQUEST_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-15",
  description: "A task update that sends no pull request URL removes the pull request links from that task, so an agent can undo a mistaken attachment. Off keeps the current refusal.",
  releaseRisk: {
    risk: "small",
    reason: "Only removes pull request links from a task the caller can already write to. Nothing else on the task changes, and the same link can be added again.",
  },
} as const satisfies FeatureFlagDefinition;
