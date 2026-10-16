import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG = "htpr-7272-payment-login-agent-events";

export default {
  key: HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG,
  kind: "feature",
  shippedOn: "2026-10-16",
  defaultMode: "OWNER_AND_QA",
  description: "Records payment_succeeded, signup_page_viewed and agent_connected per durable connection in PostHog, delivered through a retried outbox.",
  releaseRisk: {
    "risk": "none",
    "reason": "Records payment, login page and agent connection analytics for reporting without changing what users see or billing."
  },
} as const satisfies FeatureFlagDefinition;
