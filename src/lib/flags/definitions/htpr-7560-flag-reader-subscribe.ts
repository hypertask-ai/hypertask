import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7560_FLAG_READER_SUBSCRIBE_FLAG = "htpr-7560-flag-reader-subscribe";

export default {
  key: HTPR_7560_FLAG_READER_SUBSCRIBE_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "Subscribes each flag reader to its own value so unchanged flags do not redraw the screen after loading.",
  releaseRisk: {
    risk: "small",
    reason: "Changes flag subscriptions without changing their answers, preserving the existing provider when switched off.",
  },
} as const satisfies FeatureFlagDefinition;
