import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7775_SAVED_URL_VIEW_FLAG = "htpr-7775-saved-url-view";

export default {
  key: HTPR_7775_SAVED_URL_VIEW_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description:
    "Saved board links rebuild visible columns and ticket order for the selected view. Off preserves the previous view's sections.",
  releaseRisk: {
    risk: "small",
    reason: "Rebuilds in-memory board sections without changing saved views or tickets.",
  },
} as const satisfies FeatureFlagDefinition;
