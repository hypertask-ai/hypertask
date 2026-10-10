import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7010_HAIKU_5_5_FLAG = "htpr-7010-haiku-5-5";

export default {
  key: HTPR_7010_HAIKU_5_5_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-08",
  description: "Makes Haiku 5.5 the default for paid and compatible BYOK accounts, keeps Luna the Free default, and replaces saved Haiku 4.5 choices when enabled.",
} as const satisfies FeatureFlagDefinition;
