import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7774_INCLUSIVE_CALENDAR_RANGE_FLAG = "htpr-7774-inclusive-calendar-range";

export default {
  key: HTPR_7774_INCLUSIVE_CALENDAR_RANGE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Custom created, updated and due date calendar filters include the entire final selected day. Off restores midnight endpoints.",
  releaseRisk: {
    risk: "small",
    reason: "Only normalizes custom calendar end dates; exact timestamp predicates and other date filter modes remain unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
