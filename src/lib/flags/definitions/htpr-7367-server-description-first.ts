import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7367_SERVER_DESCRIPTION_FIRST_FLAG = "htpr-7367-server-description-first";

export default {
  key: HTPR_7367_SERVER_DESCRIPTION_FIRST_FLAG,
  kind: "improvement",
  shippedOn: "2026-10-19",
  description: "Sends a ticket's description inside the first page load, so a cold ticket open on a phone shows it seconds sooner.",
  related: ["htpr-7091-static-description-first", "htpr-6752-instant-ticket-open"],
  releaseRisk: {
    "risk": "small",
    "reason": "The description looks the same; it arrives with the page instead of after the app code loads."
  },
} as const satisfies FeatureFlagDefinition;
