import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7268_INVITE_SEAT_ANALYTICS_FLAG = "htpr-7268-invite-seat-analytics";

export default {
  key: HTPR_7268_INVITE_SEAT_ANALYTICS_FLAG,
  kind: "feature",
  shippedOn: "2026-10-16",
  defaultMode: "OWNER_AND_QA",
  description: "Records invite_sent, member_joined and Stripe seat events in PostHog instead of teammate_invited and invite_accepted.",
  releaseRisk: {
    "risk": "none",
    "reason": "Records invite and seat analytics for reporting without changing what users see or billing."
  },
} as const satisfies FeatureFlagDefinition;
