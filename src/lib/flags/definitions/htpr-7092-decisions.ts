import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7092_DECISIONS_FLAG = "htpr-7092-decisions";

export default {
  key: HTPR_7092_DECISIONS_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-10",
  description: "Adds a Decisions split in the Inbox and a Decisions view on every board for tickets waiting on your yes or no.",
  releaseRisk: {
    "risk": "new",
    "reason": "The Inbox gains a Decisions split and every board gains a Decisions view tab; with the flag off nothing changes."
  },
} as const satisfies FeatureFlagDefinition;
