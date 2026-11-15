import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8998_JUMP_TO_TOP_FLAG = "htpr-8998-jump-to-top";

export default {
  key: HTPR_8998_JUMP_TO_TOP_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-15",
  description:
    "Long tickets on desktop show a 32px square jump to top button after you scroll down. Hover says Jump to top with G G. A click scrolls to the top the same way G G does.",
  releaseRisk: {
    risk: "new",
    reason:
      "Adds one button on the ticket page. Off leaves the page as it is today. G G still jumps to the top.",
  },
} as const satisfies FeatureFlagDefinition;
