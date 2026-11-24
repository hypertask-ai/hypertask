import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9533_PROBE_SYNTHETIC_FLAG = "htpr-9533-probe-synthetic";

export default {
  key: HTPR_9533_PROBE_SYNTHETIC_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-22",
  description: "Daily probe mailboxes count as synthetic, so they stop showing up as customers in activation.",
  releaseRisk: {
    risk: "small",
    reason: "Only which probe accounts send activation events changes. Off counts probe mail as a customer again. Nothing in the app changes.",
  },
} as const satisfies FeatureFlagDefinition;
