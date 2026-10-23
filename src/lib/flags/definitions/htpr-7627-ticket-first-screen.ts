import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7627_TICKET_FIRST_SCREEN_FLAG = "htpr-7627-ticket-first-screen";

export default {
  key: HTPR_7627_TICKET_FIRST_SCREEN_FLAG,
  kind: "improvement",
  shippedOn: "2026-10-23",
  defaultMode: "OWNER_AND_QA",
  description: "Seed ticket document flags and display preferences before the first client render, without board or inbox data.",
  releaseRisk: {
    risk: "small",
    highRisk: "access",
    reason: "Embeds account-scoped flags and preferences in ticket HTML; Owner + QA limits rollout while cookie identity and private caching are verified. Off preserves the unseeded path.",
  },
} as const satisfies FeatureFlagDefinition;
