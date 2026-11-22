import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8998_TICKET_JUMP_TO_TOP_FLAG = "htpr-8998-ticket-jump-to-top";

export default {
  key: HTPR_8998_TICKET_JUMP_TO_TOP_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-22",
  description:
    "A long ticket shows a jump to top button after you scroll down. Clicking it, or pressing G then G, returns to the top.",
  releaseRisk: {
    risk: "small",
    reason:
      "Adds one button and one shortcut on the ticket page. Off hides the button and G then G moves to the description again.",
  },
} as const satisfies FeatureFlagDefinition;
