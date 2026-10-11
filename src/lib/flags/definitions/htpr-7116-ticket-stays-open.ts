import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7116_TICKET_STAYS_OPEN_FLAG = "htpr-7116-ticket-stays-open";

export default {
  key: HTPR_7116_TICKET_STAYS_OPEN_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-11",
  description: "A ticket opened on a phone stays on screen while its editor and comment box finish loading, instead of disappearing for a moment.",
  related: ["htpr-6991-back-first-open", "htpr-6752-instant-ticket-open"],
  releaseRisk: {
    "risk": "small",
    "reason": "The ticket looks the same; the editor and comment box still arrive at the same moment, only the brief blank screen is gone."
  },
} as const satisfies FeatureFlagDefinition;
