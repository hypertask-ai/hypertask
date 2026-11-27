import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8998_TICKET_JUMP_TO_TOP_FLAG = "htpr-8998-ticket-jump-to-top";

export default {
  key: HTPR_8998_TICKET_JUMP_TO_TOP_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-25",
  description:
    "A long ticket on desktop shows a square 32px jump to top button at the bottom right once the page has scrolled. A click, or G then G, returns to the top. Hover says Jump to top with G G.",
  releaseRisk: {
    risk: "new",
    reason:
      "One new button on the ticket page under design review. Off hides the button and leaves G then G moving to the description as it does today.",
  },
} as const satisfies FeatureFlagDefinition;
