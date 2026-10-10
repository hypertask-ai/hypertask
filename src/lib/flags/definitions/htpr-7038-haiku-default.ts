import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7038_HAIKU_DEFAULT_FLAG = "htpr-7038-haiku-default";

export default {
  key: HTPR_7038_HAIKU_DEFAULT_FLAG,
  kind: "feature",
  shippedOn: "2026-10-09",
  description: "Defaults all accounts without a saved model to Haiku 5.5 and uses it for automatic summaries and fast system calls.",
} as const satisfies FeatureFlagDefinition;
