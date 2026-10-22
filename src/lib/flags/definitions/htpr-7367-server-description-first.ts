import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7367_SERVER_DESCRIPTION_FIRST_FLAG = "htpr-7367-server-description-first";

export default {
  key: HTPR_7367_SERVER_DESCRIPTION_FIRST_FLAG,
  kind: "improvement",
  shippedOn: "2026-10-19",
  description: "Sends a ticket's description inside the first page load, so a cold ticket open on a phone shows it seconds sooner.",
  related: ["htpr-7091-static-description-first"],
  releaseRisk: {
    "risk": "small",
    "reason": "The description text and layout arrive with the page; its edit controls, reactions and time follow when the app code loads, as before, about a second later than today."
  },
} as const satisfies FeatureFlagDefinition;
