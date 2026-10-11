import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7130_CARD_TAP_NO_RELOAD_FLAG = "htpr-7130-card-tap-no-reload";

export default {
  key: HTPR_7130_CARD_TAP_NO_RELOAD_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-11",
  description: "Tapping a board card on a phone right after the board appears opens the ticket in place instead of reloading the whole page.",
  related: ["htpr-6934-server-first-screen", "htpr-7116-ticket-stays-open"],
  releaseRisk: {
    "risk": "small",
    "reason": "Only a tap that lands before the board finishes starting up is affected; it now waits a moment and opens the ticket in place instead of loading the page again."
  },
} as const satisfies FeatureFlagDefinition;
