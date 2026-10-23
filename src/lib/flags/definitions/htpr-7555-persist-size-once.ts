import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7555_PERSIST_SIZE_ONCE_FLAG = "htpr-7555-persist-size-once";

export default {
  key: HTPR_7555_PERSIST_SIZE_ONCE_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "The app remembers whether unchanged query data fits the saved-cache size limit instead of measuring it again on every cache event.",
  releaseRisk: {
    risk: "small",
    reason: "The same query filters, byte limits and persisted data remain; only repeated size checks are skipped. Off restores measurement on every event.",
  },
} as const satisfies FeatureFlagDefinition;
