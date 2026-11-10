import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8998_JUMP_TO_TOP_FLAG = "htpr-8998-jump-to-top";

export default {
  key: HTPR_8998_JUMP_TO_TOP_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description:
    "Long tickets on desktop show a small square jump to top button in the bottom right corner of the comment column once scrolled down. Hover shows Jump to top with G G; click scrolls to the top like G G.",
  releaseRisk: {
    risk: "new",
    reason:
      "Visible UI change to the ticket detail page under design review. Off keeps the page exactly as today.",
  },
} as const satisfies FeatureFlagDefinition;
