import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7687_ALLOWANCE_RESYNC_FLAG = "htpr-7687-allowance-resync";

export default {
  key: HTPR_7687_ALLOWANCE_RESYNC_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description:
    "A team refused for its AI allowance has its counter re-checked against the AI Gateway's real spend, at most once a minute, so leftover worst-case charges from stopped or unfinished answers stop blocking AI.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only the refusal path changes; the counter is lowered only to the gateway's reported spend plus every call settled in the last 15 minutes, never before that record covers 25 minutes, and a failed gateway lookup keeps the refusal."
  },
} as const satisfies FeatureFlagDefinition;
