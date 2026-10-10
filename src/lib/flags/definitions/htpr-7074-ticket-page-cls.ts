import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7074_TICKET_PAGE_CLS_FLAG = "htpr-7074-ticket-page-cls";

export default {
  key: HTPR_7074_TICKET_PAGE_CLS_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-10",
  description: "Keeps the comment box out of sight until a ticket's comments have finished loading, so it no longer jumps down the page on first open.",
  releaseRisk: {
    "risk": "small",
    "reason": "The comment box appears a moment later on a freshly opened ticket instead of jumping down the page."
  },
} as const satisfies FeatureFlagDefinition;
