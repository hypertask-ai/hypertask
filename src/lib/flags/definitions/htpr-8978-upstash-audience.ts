import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8978_UPSTASH_AUDIENCE_FLAG = "htpr-8978-upstash-audience";

export default {
  key: HTPR_8978_UPSTASH_AUDIENCE_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description: "Routes agent traffic through in-memory Redis, keeps human flag reads in a one-minute process cache, and records per-audience Upstash command metrics.",
} as const satisfies FeatureFlagDefinition;
