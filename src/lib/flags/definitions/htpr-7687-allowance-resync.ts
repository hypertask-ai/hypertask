import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7687_ALLOWANCE_RESYNC_FLAG = "htpr-7687-allowance-resync";

export default {
  key: HTPR_7687_ALLOWANCE_RESYNC_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description:
    "The plan's AI allowance counter follows real AI spend: stopped or unfinished answers count what was actually streamed, and a refused call re-checks the counter against the AI Gateway's real spend at most once a minute per team.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only the allowance bookkeeping changes; the counter is only lowered to the gateway's reported spend plus the last 15 minutes of settled calls, and a failed gateway lookup keeps the refusal."
  },
} as const satisfies FeatureFlagDefinition;
