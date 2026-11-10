import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8978_UPSTASH_AUDIENCE_FLAG = "htpr-8978-upstash-audience";

export default {
  key: HTPR_8978_UPSTASH_AUDIENCE_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description: "Routes agent traffic through in-memory Redis, keeps human flag reads in a one-minute process cache, and records per-audience Upstash command metrics.",
  releaseRisk: {
    risk: "medium",
    reason: "Changes how fast flag answers refresh and stops agent Redis spend. Flag Off restores today traffic; revert drops the in-memory routing.",
  },
} as const satisfies FeatureFlagDefinition;
