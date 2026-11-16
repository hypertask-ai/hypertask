import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9388_LOG_FAILED_HELP_ARTICLES_FLAG =
  "htpr-9388-log-failed-help-articles";

export default {
  key: HTPR_9388_LOG_FAILED_HELP_ARTICLES_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-16",
  description:
    "Help search names the help article that failed to load in a server warning. Off keeps the failure silent.",
  releaseRisk: {
    risk: "small",
    reason:
      "Server log only: one warning per failed help article. Off writes nothing extra, and the answer returned to the user is the same either way.",
  },
} as const satisfies FeatureFlagDefinition;
