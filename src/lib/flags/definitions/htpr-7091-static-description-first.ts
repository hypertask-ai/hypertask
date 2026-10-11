import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7091_STATIC_DESCRIPTION_FIRST_FLAG = "htpr-7091-static-description-first";

export default {
  key: HTPR_7091_STATIC_DESCRIPTION_FIRST_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-11",
  description: "Shows a ticket's description as soon as the page loads and brings in the editor afterwards, so the first ticket open on a phone is faster.",
  related: ["htpr-6752-instant-ticket-open"],
  releaseRisk: {
    "risk": "small",
    "reason": "The description looks the same; only the editor behind it arrives a moment later."
  },
} as const satisfies FeatureFlagDefinition;
