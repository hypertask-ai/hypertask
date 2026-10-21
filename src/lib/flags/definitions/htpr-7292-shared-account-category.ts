import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7292_SHARED_ACCOUNT_CATEGORY_FLAG = "htpr-7292-shared-account-category";

export default {
  key: HTPR_7292_SHARED_ACCOUNT_CATEGORY_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-17",
  defaultMode: "EVERYONE",
  description: "Every server analytics event and activation check uses one account category rule, so QA, test and Hypertask accounts stop counting as customers.",
  releaseRisk: {
    risk: "small",
    reason: "Only analytics properties and which test accounts send activation events change; nothing people see in the app changes.",
  },
} as const satisfies FeatureFlagDefinition;
