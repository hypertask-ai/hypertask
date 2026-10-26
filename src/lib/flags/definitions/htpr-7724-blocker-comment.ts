import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7724_BLOCKER_COMMENT_FLAG = "htpr-7724-blocker-comment";

export default {
  key: HTPR_7724_BLOCKER_COMMENT_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Mark one ticket comment as the blocker with a red frame, from the app or MCP/API alongside the blocking person.",
  releaseRisk: {
    risk: "small",
    reason: "Adds a reversible comment marker using existing task access checks, comment commands and waiting-on writes.",
  },
} as const satisfies FeatureFlagDefinition;
