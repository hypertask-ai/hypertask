import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7278_MEMORY_ONLY_TRACKING_FLAG = "htpr-7278-memory-only-tracking";

export default {
  key: HTPR_7278_MEMORY_ONLY_TRACKING_FLAG,
  kind: "improvement",
  shippedOn: "2026-10-16",
  description: "Browser PostHog in the app keeps its data in memory only: no cookies, no localStorage and no session recording. Product events keep coming from our servers.",
  releaseRisk: {
    risk: "small",
    reason: "Only PostHog's browser storage and guest session recording change; events, error capture and server-side events are unchanged, and flag Off restores the previous storage.",
  },
} as const satisfies FeatureFlagDefinition;
