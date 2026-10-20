import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7395_PHONE_BOARD_WARMS_TICKET_FLAG = "htpr-7395-phone-board-warms-ticket";

export default {
  key: HTPR_7395_PHONE_BOARD_WARMS_TICKET_FLAG,
  kind: "improvement",
  shippedOn: "2026-10-20",
  description: "On a phone board, downloads the ticket page code in the background once the board has painted, so the first ticket tapped opens seconds sooner.",
  related: ["htpr-7008-phone-first-paint", "htpr-6752-instant-ticket-open"],
  releaseRisk: {
    "risk": "small",
    "reason": "Nothing on screen changes. The phone downloads about 450 KB of ticket code after the board shows instead of on the first tap, which can briefly share the connection with the board's own later loads."
  },
} as const satisfies FeatureFlagDefinition;
